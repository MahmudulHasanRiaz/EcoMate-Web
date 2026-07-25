import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  BadRequestException,
  InternalServerErrorException,
  ConflictException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { Roles } from '../common/decorators/roles.decorator';
import { Public } from '../common/decorators/public.decorator';
import { SkipLicenseCheck } from '../common/decorators/skip-license-check.decorator';
import { RequiresFeature } from '@ecomate/feature-flags';
import { execSync } from 'child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'fs';

const PKG_LOCK_KEY = 'android_package_id_locked';
const COMPILE_KEYS = ['store_name', 'storefront_favicon', 'brand_primary'] as const;
const STALE_BUILD_MINUTES = 15;

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function computePackageId(storeName: string): string {
  const id = slugify(storeName || 'app');
  return `com.ecomate.${id}`;
}

@Controller('mobile-builder')
export class MobileBuilderController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly featureFlags: FeatureFlagsService,
  ) {}

  // ── Generic compile-time metadata (for admin UI preview) ──
  @Get('metadata')
  @RequiresFeature('mobile_distribution')
  async getGenericMetadata() {
    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: COMPILE_KEYS as unknown as string[] } },
    });
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;

    return {
      clientDomain: process.env.CLIENT_DOMAIN || '',
      appName: map['store_name'] || 'EcoMate',
      packageId: `com.ecomate.${(map['store_name'] || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      versionName: '1.0.0',
      versionCode: 1,
      iconUrl: map['storefront_favicon'] || '',
      splashColor: map['brand_primary'] || '#0089CD',
    };
  }

  // ── Minimal compile-time metadata, by buildId (public for builder) ──
  @Public()
  @SkipLicenseCheck()
  @Get('metadata/:buildId')
  async getMetadataForBuild(@Param('buildId') buildId: string) {
    const build = await this.prisma.mobileBuild.findUnique({ where: { id: buildId } });
    if (!build) throw new BadRequestException('Build not found');

    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: COMPILE_KEYS as unknown as string[] } },
    });
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;

    return {
      buildId,
      clientDomain: build.clientDomain || process.env.CLIENT_DOMAIN || '',
      appName: map['store_name'] || 'EcoMate',
      packageId: build.packageId || computePackageId(map['store_name'] || ''),
      bundleId: build.packageId || computePackageId(map['store_name'] || ''),
      versionName: build.versionName,
      versionCode: build.versionCode,
      iconUrl: map['storefront_favicon'] || '',
      splashColor: map['brand_primary'] || '#0089CD',
    };
  }

  // ── Ready check — validates prerequisites ──
  @Get('ready')
  @RequiresFeature('mobile_distribution')
  async getReadyStatus() {
    const missing: string[] = [];

    if (!process.env.CLIENT_DOMAIN) missing.push('CLIENT_DOMAIN');
    if (!this.featureFlags.canUse('mobile_distribution')) missing.push('License: mobile_distribution');

    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: COMPILE_KEYS as unknown as string[] } },
    });
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;

    if (!map['store_name']) missing.push('App Name (store_name)');
    if (!map['storefront_favicon']) missing.push('App Icon (storefront_favicon)');
    if (!map['brand_primary']) missing.push('Primary Color (brand_primary)');

    return {
      ready: missing.length === 0,
      missing,
      summary: {
        license: this.featureFlags.canUse('mobile_distribution'),
        branding: !!(map['store_name'] && map['storefront_favicon'] && map['brand_primary']),
        domain: !!process.env.CLIENT_DOMAIN,
        packageId: true,
      },
    };
  }

  // ── Build history ──
  @Get('builds')
  @RequiresFeature('mobile_distribution')
  async getBuildHistory() {
    const builds = await this.prisma.mobileBuild.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return builds.map((b) => ({
      id: b.id,
      app: b.app,
      platform: b.platform,
      status: b.status,
      versionName: b.versionName,
      versionCode: b.versionCode,
      errorMessage: b.errorMessage,
      artifactPath: b.artifactPath,
      buildLogUrl: b.buildLogUrl,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
    }));
  }

  // ── Single build detail ──
  @Get('builds/:id')
  @RequiresFeature('mobile_distribution')
  async getBuildDetail(@Param('id') id: string) {
    const build = await this.prisma.mobileBuild.findUnique({ where: { id } });
    if (!build) throw new BadRequestException('Build not found');
    return build;
  }

  // ── Cancel a build ──
  @Post('builds/:id/cancel')
  @Roles('superadmin', 'admin')
  @RequiresFeature('mobile_distribution')
  async cancelBuild(@Param('id') id: string) {
    const build = await this.prisma.mobileBuild.findUnique({ where: { id } });
    if (!build) throw new BadRequestException('Build not found');
    if (!['queued', 'running', 'uploading'].includes(build.status)) throw new BadRequestException(`Cannot cancel build with status ${build.status}`);

    await this.prisma.mobileBuild.update({ where: { id }, data: { status: 'cancelled', errorMessage: 'Cancelled by admin' } });
    return { cancelled: true, buildId: id };
  }

  // ── Publish (trigger) ──
  @Post('publish')
  @Roles('superadmin', 'admin')
  @RequiresFeature('mobile_distribution')
  async publishBuild(@Body() body: { app?: string; platform?: string }) {
    const appInput = body?.app || 'storefront';
    const platform = body?.platform || 'android';

    // Resolve target apps
    const apps = appInput === 'all'
      ? ['storefront', 'admin', 'pos'].filter(a => this.featureFlags.canUse(a === 'storefront' ? 'mobile_distribution' : `mobile_distribution_${a}`))
      : [appInput];

    if (apps.length === 0) throw new BadRequestException('No licensed apps to publish');
    for (const a of apps) {
      if (!['storefront', 'admin', 'pos'].includes(a)) throw new BadRequestException(`Invalid app: ${a}`);
    }
    if (apps.length === 1 && !['storefront', 'admin', 'pos'].includes(appInput)) throw new BadRequestException('app must be storefront, admin, pos, or all');
    if (!['android', 'ios'].includes(platform)) throw new BadRequestException('platform must be android or ios');

    // Validate prerequisites once
    const readyStatus = await this.getReadyStatus();
    if (!readyStatus.ready) throw new BadRequestException(`Prerequisites not met: ${readyStatus.missing.join(', ')}`);

    // Auto-fail stale builds
    const staleCutoff = new Date(Date.now() - STALE_BUILD_MINUTES * 60 * 1000);
    const staleBuilds = await this.prisma.mobileBuild.findMany({ where: { status: { in: ['running', 'uploading'] }, clientDomain: process.env.CLIENT_DOMAIN, updatedAt: { lt: staleCutoff } } });
    for (const s of staleBuilds) await this.prisma.mobileBuild.update({ where: { id: s.id }, data: { status: 'failed', errorMessage: `Stale: no update for ${STALE_BUILD_MINUTES}+ min` } });

    const runningCount = await this.prisma.mobileBuild.count({ where: { status: { in: ['queued', 'running', 'uploading'] }, clientDomain: process.env.CLIENT_DOMAIN } });
    if (runningCount > 0) throw new ConflictException('A build is already queued or in progress');

    // Resolve immutable packageId
    const locked = await this.prisma.systemSetting.findUnique({ where: { key: PKG_LOCK_KEY } });
    const settings = await this.prisma.systemSetting.findMany({ where: { key: { in: ['store_name'] as string[] } } });
    const smap: Record<string, string> = {};
    for (const s of settings) smap[s.key] = s.value;
    const packageId = locked?.value || computePackageId(smap['store_name'] || '');
    if (!locked) await this.prisma.systemSetting.upsert({ where: { key: PKG_LOCK_KEY }, create: { key: PKG_LOCK_KEY, value: packageId }, update: {} });

    // Create build records for each app
    const builds: any[] = [];
    for (const a of apps) {
      const latest = await this.prisma.mobileBuild.findFirst({ where: { app: a, platform }, orderBy: { versionCode: 'desc' } });
      builds.push(await this.prisma.mobileBuild.create({ data: { app: a, platform, status: 'queued', versionName: '1.0.0', versionCode: (latest?.versionCode || 0) + 1, clientDomain: process.env.CLIENT_DOMAIN || '', packageId } }));
    }

    // Trigger GitHub dispatch
    const githubToken = process.env.MOBILE_BUILDER_GITHUB_TOKEN;
    const builderRepo = process.env.MOBILE_BUILDER_REPO || 'EcoMate-Mobile-Builder';
    const githubOwner = process.env.GITHUB_REPOSITORY_OWNER || 'mahmudulhasanriaz';
    if (!githubToken) {
      for (const b of builds) await this.prisma.mobileBuild.update({ where: { id: b.id }, data: { status: 'failed', errorMessage: 'MOBILE_BUILDER_GITHUB_TOKEN missing' } });
      throw new InternalServerErrorException('Builder token not configured');
    }

    try {
      const erpUrl = process.env.BETTER_AUTH_URL || `https://${process.env.CLIENT_DOMAIN}`;
      const response = await fetch(`https://api.github.com/repos/${githubOwner}/${builderRepo}/dispatches`, {
        method: 'POST',
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${githubToken}`, 'User-Agent': 'EcoMate-Backend' },
        body: JSON.stringify({
          event_type: 'mobile-build',
          client_payload: { buildId: builds[0].id, app: appInput, platform, erpUrl, callbackToken: process.env.MOBILE_BUILDER_CALLBACK_TOKEN || '' },
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => 'unknown');
        for (const b of builds) await this.prisma.mobileBuild.update({ where: { id: b.id }, data: { status: 'failed', errorMessage: `GitHub API: ${response.status}` } });
        throw new Error(`GitHub API responded ${response.status}`);
      }

      // Mark first build as running, start background poll
      if (builds.length > 0) {
        await this.prisma.mobileBuild.update({ where: { id: builds[0].id }, data: { status: 'running' } });
        this.pollForArtifact(builds[0].id, appInput, platform || 'android', githubToken, githubOwner, builderRepo, false);
      }

      return {
        published: true,
        builds: builds.map(b => ({ buildId: b.id, app: b.app, platform, status: b.id === builds[0].id ? 'running' : 'queued' })),
        app: appInput,
        platform,
      };
    } catch (err: any) {
      for (const b of builds) await this.prisma.mobileBuild.update({ where: { id: b.id }, data: { status: 'failed', errorMessage: err.message } });
      throw new InternalServerErrorException(`Publish failed: ${err.message}`);
    }
  }

  // ── Manual pull: check GitHub for latest completed build ──
  @Post('pull-pending')
  @Roles('superadmin', 'admin')
  @RequiresFeature('mobile_distribution')
  async pullPendingBuild(@Body() body: { buildId?: string }) {
    const token = process.env.MOBILE_BUILDER_GITHUB_TOKEN;
    const repoName = process.env.MOBILE_BUILDER_REPO || 'EcoMate-Mobile-Builder';
    const owner = process.env.GITHUB_REPOSITORY_OWNER || 'mahmudulhasanriaz';

    if (!token) throw new InternalServerErrorException('MOBILE_BUILDER_GITHUB_TOKEN not configured');

    // Find the build to pull for
    const where: any = { status: { in: ['running', 'queued'] } };
    if (body.buildId) where.id = body.buildId;
    const build = await this.prisma.mobileBuild.findFirst({ where, orderBy: { createdAt: 'desc' } });
    if (!build) throw new BadRequestException('No pending builds found');

    const app = build.app || 'storefront';
    const platform = build.platform || 'android';

    // Query latest successful runs from builder repo
    const since = new Date(build.createdAt.getTime() - 60_000).toISOString();
    const runsUrl = `https://api.github.com/repos/${owner}/${repoName}/actions/runs?event=repository_dispatch&created=>=${since}&per_page=5&status=completed`;
    const res = await fetch(runsUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'EcoMate-Backend' },
    });
    if (!res.ok) throw new InternalServerErrorException(`GitHub API ${res.status}`);

    const data: any = await res.json();
    const run = data.workflow_runs?.find((r: any) => r.conclusion === 'success');
    if (!run) throw new BadRequestException('No completed build found on GitHub. CI may still be running.');

    // Pull artifact
    const artifactPath = await this.pullArtifactFromGitHub(String(run.id), app, platform, build.id, token, owner, repoName);

    await this.prisma.mobileBuild.update({
      where: { id: build.id },
      data: { status: 'completed', artifactPath },
    });

    return { success: true, buildId: build.id, status: 'completed', artifactPath, runId: run.id };
  }

  // ── Artifact upload (multipart) ──
  @Post('artifact')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const baseDir = process.env.MOBILE_BUILD_DIR || './mobile-builds';
          const app = req.body?.app || 'storefront';
          const platform = req.body?.platform || 'android';
          const dir = join(baseDir, app, platform);
          cb(null, dir);
        },
        filename: (req, file, cb) => {
          const ext = extname(file.originalname) || '.apk';
          cb(null, `latest${ext}`);
        },
      }),
    }),
  )
  async receiveArtifact(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
  ) {
    const callbackToken = process.env.MOBILE_BUILDER_CALLBACK_TOKEN;
    if (callbackToken && body.callbackToken !== callbackToken) {
      throw new BadRequestException('Invalid callback token');
    }

    const { buildId, app, platform, status, buildLogUrl, errorMessage } = body;
    if (!buildId || !status) throw new BadRequestException('buildId and status required');

    const existing = await this.prisma.mobileBuild.findUnique({ where: { id: buildId } });
    if (!existing) throw new BadRequestException(`Build ${buildId} not found`);

    const updateData: any = { status };
    if (file?.path) updateData.artifactPath = file.path;
    if (buildLogUrl) updateData.buildLogUrl = buildLogUrl;
    if (errorMessage) updateData.errorMessage = errorMessage;
    if (app) updateData.app = app;
    if (platform) updateData.platform = platform;

    await this.prisma.mobileBuild.update({ where: { id: buildId }, data: updateData });

    return { received: true, buildId, status };
  }

  // ── Pull artifact from GitHub Actions (no multipart upload needed) ──
  @Post('artifact/pull')
  async receiveArtifactFromGitHub(@Body() body: any) {
    const callbackToken = process.env.MOBILE_BUILDER_CALLBACK_TOKEN;
    if (callbackToken && body.callbackToken !== callbackToken) {
      throw new BadRequestException('Invalid callback token');
    }

    const { buildId, app, platform, status, runId } = body;
    if (!buildId || !status) throw new BadRequestException('buildId and status required');
    if (body.status === 'completed' && !runId) throw new BadRequestException('runId required for GitHub artifact pull');

    const existing = await this.prisma.mobileBuild.findUnique({ where: { id: buildId } });
    if (!existing) throw new BadRequestException(`Build ${buildId} not found`);

    // If status is completed, pull artifact from GitHub
    let artifactPath: string | undefined;
    if (body.status === 'completed' && runId) {
      const token = process.env.MOBILE_BUILDER_GITHUB_TOKEN;
      const owner = process.env.GITHUB_REPOSITORY_OWNER || 'mahmudulhasanriaz';
      const repo = process.env.MOBILE_BUILDER_REPO || 'EcoMate-Mobile-Builder';

      if (!token) throw new InternalServerErrorException('MOBILE_BUILDER_GITHUB_TOKEN not configured');

      try {
        artifactPath = await this.pullArtifactFromGitHub(runId, app || 'storefront', platform || 'android', buildId, token, owner, repo);
      } catch (err: any) {
        await this.prisma.mobileBuild.update({
          where: { id: buildId },
          data: { status: 'failed', errorMessage: `Artifact pull failed: ${err.message}` },
        });
        return { received: true, buildId, status: 'failed', errorMessage: err.message };
      }
    }

    const updateData: any = { status };
    if (artifactPath) updateData.artifactPath = artifactPath;
    if (body.buildLogUrl) updateData.buildLogUrl = body.buildLogUrl;
    if (body.errorMessage) updateData.errorMessage = body.errorMessage;
    if (app) updateData.app = app;
    if (platform) updateData.platform = platform;

    await this.prisma.mobileBuild.update({ where: { id: buildId }, data: updateData });
    return { received: true, buildId, status, artifactPath };
  }

  private async pullArtifactFromGitHub(
    runId: string, app: string, platform: string, buildId: string,
    token: string, owner: string, repo: string,
  ): Promise<string> {
    const artifactName = `${app}-${platform}-apk`;

    // 1. List artifacts for the run
    const listUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`;
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'EcoMate-Backend' },
    });
    if (!listRes.ok) throw new Error(`GitHub API ${listRes.status} listing artifacts`);

    const listData: any = await listRes.json();
    const artifact = listData.artifacts?.find((a: any) => a.name === artifactName);
    if (!artifact) throw new Error(`Artifact "${artifactName}" not found`);

    // 2. Download (follow redirect)
    const dlRes = await fetch(artifact.archive_download_url, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'EcoMate-Backend' },
      redirect: 'follow',
    });
    if (!dlRes.ok) throw new Error(`Download returned ${dlRes.status}`);

    // 3. Save zip + extract
    const baseDir = process.env.MOBILE_BUILD_DIR || './mobile-builds';
    const tmpDir = join(baseDir, '.tmp', buildId);
    const zipPath = join(baseDir, '.tmp', `${buildId}.zip`);
    mkdirSync(join(baseDir, '.tmp'), { recursive: true });

    writeFileSync(zipPath, Buffer.from(await dlRes.arrayBuffer()));
    execSync(`unzip -o "${zipPath}" -d "${tmpDir}"`, { stdio: 'pipe' });

    // 4. Find APK in extracted files
    const apkFile = this.findFile(tmpDir, (p: string) => p.endsWith('.apk'));
    if (!apkFile) throw new Error('No APK found in downloaded artifact');

    // 5. Copy to mobile-builds
    const outDir = join(baseDir, app, platform);
    mkdirSync(outDir, { recursive: true });
    copyFileSync(apkFile, join(outDir, 'latest.apk'));

    // 6. Cleanup
    try { rmSync(zipPath); rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

    return join(outDir, 'latest.apk');
  }

  private findFile(dir: string, predicate: (path: string) => boolean): string | null {
    if (!existsSync(dir)) return null;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (predicate(full)) return full;
      if (entry.isDirectory()) {
        const found = this.findFile(full, predicate);
        if (found) return found;
      }
    }
    return null;
  }

  // ── Poll GitHub for completed workflow run, then pull artifact ──
  private pollForArtifact(
    buildId: string, app: string, platform: string,
    token: string, owner: string, repo: string,
    quiet = true,
  ): void {
    const dispatchTime = new Date();
    let attempts = 0;
    const maxAttempts = 12; // 12 * 30s = 6 min timeout
    const pollInterval = 30_000;

    const check = async () => {
      attempts++;
      try {
        // Query workflow runs created after our dispatch
        const since = dispatchTime.toISOString();
        const runsUrl = `https://api.github.com/repos/${owner}/${repo}/actions/runs?event=repository_dispatch&created=>=${since}&per_page=5&status=completed`;
        const res = await fetch(runsUrl, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'EcoMate-Backend' },
        });
        if (!res.ok) throw new Error(`GitHub API ${res.status}`);

        const data: any = await res.json();
        const successfulRun = data.workflow_runs?.find(
          (r: any) => r.conclusion === 'success',
        );

        if (successfulRun) {
          // Found completed run — pull artifact
          const artifactPath = await this.pullArtifactFromGitHub(
            String(successfulRun.id), app, platform, buildId, token, owner, repo,
          );
          await this.prisma.mobileBuild.update({
            where: { id: buildId },
            data: { status: 'completed', artifactPath },
          });
          return; // Done
        }

        // No completed run yet — retry if under limit
        if (attempts < maxAttempts) {
          setTimeout(check, pollInterval);
        } else {
          await this.prisma.mobileBuild.update({
            where: { id: buildId },
            data: { status: 'failed', errorMessage: 'Build timed out — no completed run found within 6 minutes' },
          });
        }
      } catch (err: any) {
        if (attempts < maxAttempts) {
          setTimeout(check, pollInterval);
        } else {
          await this.prisma.mobileBuild.update({
            where: { id: buildId },
            data: { status: 'failed', errorMessage: `Poll error: ${err.message}` },
          }).catch(() => {});
        }
      }
    };

    // Start first check after 30s delay
    setTimeout(check, pollInterval);
  }
}