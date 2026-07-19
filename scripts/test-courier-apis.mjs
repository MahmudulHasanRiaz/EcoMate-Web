import { createHash, randomUUID } from 'node:crypto';

const BASE = {
  steadfast: 'https://portal.packzy.com/api/v1',
  pathao: {
    sandbox: 'https://courier-api-sandbox.pathao.com',
    production: 'https://api-hermes.pathao.com',
  },
  redx: {
    sandbox: 'https://sandbox.redx.com.bd/v1.0.0-beta',
    production: 'https://openapi.redx.com.bd/v1.0.0-beta',
  },
  carrybee: 'https://developers.carrybee.com',
};

async function main() {
  const args = process.argv.slice(2);
  const test = args[0] || 'all';
  const phone = args[1] || '01711111111';

  console.log(`\n=== Courier Customer History API Tests ===\n`);
  console.log(`Phone: ${phone}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  if (test === 'all' || test === 'steadfast') {
    await testSteadfast(phone);
  }
  if (test === 'all' || test === 'pathao') {
    await testPathao(phone);
  }
  if (test === 'all' || test === 'redx') {
    await testRedx(phone);
  }
  if (test === 'all' || test === 'carrybee') {
    await testCarrybee(phone);
  }
}

async function testSteadfast(phone) {
  console.log('─── Steadfast ──────────────────────────────');
  try {
    // Official API: GET /fraud_check/{phone} with Api-Key + Secret-Key
    const res = await fetch(`${BASE.steadfast}/fraud_check/${phone.replace(/\D/g, '')}`, {
      headers: {
        'Content-Type': 'application/json',
        'Api-Key': process.env.STEADFAST_API_KEY || 'cqhcjiphzgqmcb3ct5tfhintphc5bncj',
        'Secret-Key': process.env.STEADFAST_SECRET_KEY || 'kfnwa22amcifjrllauootqu7',
      },
    });
    const data = await res.json();
    console.log(`GET /fraud_check/${phone.replace(/\D/g, '')}`);
    console.log(`Status: ${res.status}`);
    console.log(`Response: ${JSON.stringify(data, null, 2)}`);
    if (data.total_parcels !== undefined) {
      console.log('✅ Steadfast API works!');
      console.log(`  Total parcels: ${data.total_parcels}`);
      console.log(`  Delivered: ${data.total_delivered}`);
      console.log(`  Cancelled: ${data.total_cancelled}`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
  console.log('');
}

async function testPathao(phone) {
  console.log('─── Pathao ─────────────────────────────────');
  const base = BASE.pathao.sandbox;
  const clientId = process.env.PATHAO_CLIENT_ID;
  const clientSecret = process.env.PATHAO_CLIENT_SECRET;
  const username = process.env.PATHAO_USERNAME || 'test';
  const password = process.env.PATHAO_PASSWORD || 'test';

  try {
    // Step 1: Get OAuth2 token
    const tokenRes = await fetch(`${base}/aladdin/api/v1/issue-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        username,
        password,
        grant_type: 'password',
      }),
    });
    const tokenData = await tokenRes.json();
    console.log(`POST /aladdin/api/v1/issue-token → ${tokenRes.status}`);

    if (!tokenData.access_token) {
      console.log(`⚠ Auth failed: ${JSON.stringify(tokenData)}`);
      // Try merchant portal API instead
      console.log('Trying merchant portal API...');
      const merchantRes = await fetch('https://merchant.pathao.com/api/v1/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const merchantData = await merchantRes.json();
      console.log(`POST merchant.pathao.com/api/v1/login → ${merchantRes.status}`);
      console.log(`Response: ${JSON.stringify(merchantData).slice(0, 200)}`);

      if (merchantData.access_token) {
        // Test success rate endpoint
        const successRes = await fetch('https://merchant.pathao.com/api/v1/user/success', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${merchantData.access_token}`,
          },
          body: JSON.stringify({ phone }),
        });
        const successData = await successRes.json();
        console.log(`POST /api/v1/user/success → ${successRes.status}`);
        console.log(`Response: ${JSON.stringify(successData, null, 2)}`);
      }
      return;
    }

    const token = tokenData.access_token;
    console.log('✅ Got OAuth2 token');

    // Step 2: Test user success-rate endpoint
    const successRes = await fetch(`${base}/aladdin/api/v1/user/success-rate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ phone }),
    });
    const successData = await successRes.json();
    console.log(`POST /aladdin/api/v1/user/success-rate → ${successRes.status}`);
    console.log(`Response: ${JSON.stringify(successData, null, 2)}`);

    if (successData.data?.success !== undefined) {
      console.log('✅ Pathao API works!');
      console.log(`  Success: ${successData.data.success}`);
      console.log(`  Cancel: ${successData.data.cancel}`);
      console.log(`  Total: ${successData.data.total}`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
  console.log('');
}

async function testRedx(phone) {
  console.log('─── RedX ──────────────────────────────────');
  const redxPhone = process.env.REDX_PHONE;
  const redxPassword = process.env.REDX_PASSWORD;

  if (!redxPhone || !redxPassword) {
    console.log('⚠ No RedX credentials configured (REDX_PHONE + REDX_PASSWORD)');
    console.log('  To test: export REDX_PHONE=01XXXXXXX REDX_PASSWORD=yourpass');
    console.log('');
    return;
  }

  try {
    // Step 1: Login to get access token
    const loginRes = await fetch('https://api.redx.com.bd/v4/auth/login', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
      },
      body: JSON.stringify({ phone: `88${redxPhone}`, password: redxPassword }),
    });
    const loginData = await loginRes.json();
    console.log(`POST api.redx.com.bd/v4/auth/login → ${loginRes.status}`);

    const accessToken = loginData?.data?.accessToken;
    if (!accessToken) {
      console.log(`⚠ Login failed: ${JSON.stringify(loginData).slice(0, 200)}`);
      return;
    }
    console.log('✅ Got RedX access token');

    // Step 2: Get customer success-return rate
    const dataRes = await fetch(
      `https://redx.com.bd/api/redx_se/admin/parcel/customer-success-return-rate?phoneNumber=88${phone}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      },
    );
    const data = await dataRes.json();
    console.log(`GET customer-success-return-rate → ${dataRes.status}`);
    console.log(`Response: ${JSON.stringify(data, null, 2)}`);

    if (data?.data?.deliveredParcels !== undefined) {
      console.log('✅ RedX API works!');
      console.log(`  Delivered: ${data.data.deliveredParcels}`);
      console.log(`  Total: ${data.data.totalParcels}`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
  console.log('');
}

async function testCarrybee(phone) {
  console.log('─── Carrybee ──────────────────────────────');
  const cbPhone = process.env.CARRYBEE_PHONE;
  const cbPassword = process.env.CARRYBEE_PASSWORD;

  if (!cbPhone || !cbPassword) {
    console.log('⚠ No Carrybee credentials configured (CARRYBEE_PHONE + CARRYBEE_PASSWORD)');
    console.log('  To test: export CARRYBEE_PHONE=01XXXXXXX CARRYBEE_PASSWORD=yourpass');
    console.log('');
    return;
  }

  try {
    // Step 1: Get CSRF token
    const csrfRes = await fetch('https://merchant.carrybee.com/api/auth/csrf', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) width/1920 height/1080',
        'Accept': 'application/json',
        'Referer': 'https://merchant.carrybee.com/login',
      },
    });
    const csrfData = await csrfRes.json();
    console.log(`GET /api/auth/csrf → ${csrfRes.status}`);

    if (!csrfData.csrfToken) {
      console.log(`⚠ CSRF failed: ${JSON.stringify(csrfData)}`);
      return;
    }
    console.log('✅ Got CSRF token');

    // Step 2: Login
    const loginRes = await fetch('https://merchant.carrybee.com/api/auth/callback/login', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) width/1920 height/1080',
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': 'https://merchant.carrybee.com/login',
      },
      body: new URLSearchParams({
        phone: `+88${cbPhone.replace(/^0/, '')}`,
        password: cbPassword,
        csrfToken: csrfData.csrfToken,
        callbackUrl: 'https://merchant.carrybee.com/login',
      }),
    });
    console.log(`POST /api/auth/callback/login → ${loginRes.status} (redirect expected)`);

    // Step 3: Get session (for accessToken + businessId)
    const sessionRes = await fetch('https://merchant.carrybee.com/api/auth/session', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) width/1920 height/1080',
        'Accept': 'application/json',
        'Referer': 'https://merchant.carrybee.com/login',
      },
    });
    const sessionData = await sessionRes.json();
    console.log(`GET /api/auth/session → ${sessionRes.status}`);

    const accessToken = sessionData?.accessToken;
    const businessId = sessionData?.user?.selectedBusinessId;
    if (!accessToken || !businessId) {
      console.log(`⚠ Session failed: ${JSON.stringify(sessionData).slice(0, 200)}`);
      return;
    }
    console.log('✅ Got session + businessId');

    // Step 4: Fraud check
    const cleanPhone = phone.replace(/^(?:\+?88)?01/, '01');
    const fraudRes = await fetch(
      `https://api-merchant.carrybee.com/api/v2/businesses/${businessId}/fraud-check/${cleanPhone}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) width/1920 height/1080',
          'Accept': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
      },
    );
    const fraudData = await fraudRes.json();
    console.log(`GET /fraud-check/${cleanPhone} → ${fraudRes.status}`);
    console.log(`Response: ${JSON.stringify(fraudData, null, 2)}`);

    if (fraudData?.data?.total_order !== undefined) {
      console.log('✅ Carrybee API works!');
      console.log(`  Total orders: ${fraudData.data.total_order}`);
      console.log(`  Cancelled: ${fraudData.data.cancelled_order}`);
      console.log(`  Success rate: ${fraudData.data.success_rate}%`);
    }
  } catch (err) {
    console.log(`❌ Error: ${err.message}`);
  }
  console.log('');
}

main().catch(console.error);
