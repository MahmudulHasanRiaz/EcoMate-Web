import { Phone, Mail, MessageCircle, MessageCircleMore, AtSign, MapPin, HeadphonesIcon, Clock } from "lucide-react";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import SupportEnquiryForm from "@/components/SupportEnquiryForm";

/**
 * Support page (D9): dynamic contact details + real map embed + enquiry
 * form. Messenger/Instagram come from the storefront config (the same
 * source as the floating widget) — the CMS contact schema has no fields
 * for them. No channel is ever invented: a blank channel renders
 * nothing, and when ALL channels are blank the grid shows an honest
 * empty state instead of empty space.
 *
 * Hours: the old hardcoded DEFAULT_HOURS fallback is gone — hours come
 * from the CMS config only. Unconfigured hours say so instead of
 * printing invented opening times.
 */
export default async function ContactTemplate({ config }: { config: Record<string, any> }) {
  const phone: string = config?.phone || "";
  const email: string = config?.email || "";
  const whatsapp: string = config?.whatsapp || "";
  const address: string = config?.address || "";
  // Map link is not in the CMS contact schema yet (Part A owns it); read
  // defensively so adding `mapUrl`/`mapLink` later just works.
  const mapLink: string = config?.mapUrl || config?.mapLink || "";

  let storefrontConfig: Awaited<ReturnType<typeof getStorefrontConfigServer>> | null = null;
  try {
    storefrontConfig = await getStorefrontConfigServer();
  } catch {
    storefrontConfig = null;
  }
  const messengerUsername: string = storefrontConfig?.social?.messengerUsername || "";
  const instagramUrl: string = storefrontConfig?.social?.instagram || "";

  const wa = whatsapp ? `https://wa.me/${whatsapp.replace(/[^0-9]/g, "")}` : "";
  const messenger = messengerUsername
    ? `https://m.me/${messengerUsername.replace(/^@/, "").replace(/^https?:\/\/(www\.)?m\.me\//, "").replace(/\/$/, "")}`
    : "";

  const channels = [
    {
      icon: <Phone size={24} />,
      title: "Call Us",
      description: "Speak with our friendly customer service team directly.",
      actionText: phone,
      actionUrl: phone ? `tel:${phone.replace(/[^0-9]/g, "")}` : "",
      bgColor: "bg-brand-blue/10",
      iconColor: "text-brand-blue",
    },
    {
      icon: <MessageCircle size={24} />,
      title: "WhatsApp Chat",
      description: "Message us on WhatsApp for quick responses and updates.",
      actionText: "Chat on WhatsApp",
      actionUrl: wa,
      // WhatsApp brand colour — allowlisted (same as the floating widget).
      bgColor: "bg-[#25D366]/10",
      iconColor: "text-[#25D366]",
    },
    {
      icon: <Mail size={24} />,
      title: "Email Support",
      description: "Send us an email anytime and we will get back to you within 24 hours.",
      actionText: email,
      actionUrl: email ? `mailto:${email}` : "",
      bgColor: "bg-brand-blue/10",
      iconColor: "text-brand-blue",
    },
    {
      icon: <MessageCircleMore size={24} />,
      title: "Messenger",
      description: "Chat with us on Facebook Messenger.",
      actionText: "Chat on Messenger",
      actionUrl: messenger,
      // Messenger brand colour — allowlisted (same as the floating widget).
      bgColor: "bg-[#0084FF]/10",
      iconColor: "text-[#0084FF]",
    },
    {
      // No Instagram glyph in lucide 1.16 (brand icons removed).
      icon: <AtSign size={24} />,
      title: "Instagram",
      description: "Follow us and send a direct message on Instagram.",
      actionText: "Visit Instagram",
      actionUrl: instagramUrl,
      bgColor: "bg-brand-coral/10",
      iconColor: "text-brand-coral",
    },
  ].filter((c) => Boolean(c.actionUrl));

  const hours =
    Array.isArray(config?.hours) && config.hours.length ? config.hours : [];

  // Real map embed from the configured map link or address (Google Maps
  // embed needs no API key). A link that is already an embed URL is used
  // as-is; otherwise the link/address becomes the embed query. With
  // neither, there is no map — never a fake "map goes here" box.
  const mapEmbedSrc = (() => {
    if (/\/embed(\?|$)/.test(mapLink) || mapLink.includes("output=embed")) return mapLink;
    const q = mapLink || address;
    if (!q) return "";
    return `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`;
  })();

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 md:py-16">
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-blue/10 text-brand-blue rounded-full mb-4">
          <HeadphonesIcon size={32} />
        </div>
        <h2 className="text-3xl font-bold text-gray-800 mb-4">How can we help you today?</h2>
        <p className="text-gray-500 max-w-2xl mx-auto">
          We are dedicated to providing you with the best possible service. Choose from the options below to get in touch with our support team.
        </p>
      </div>

      {channels.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 border border-gray-100 shadow-sm text-center mb-16">
          <p className="text-gray-600 text-sm">
            Our contact details haven&apos;t been set up yet. Please use the form below to send us a message — we will get back to you.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-16">
          {channels.map((channel, index) => (
            <div key={index} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow text-center flex flex-col h-full">
              <div className={`w-14 h-14 mx-auto rounded-full ${channel.bgColor} ${channel.iconColor} flex items-center justify-center mb-4`}>
                {channel.icon}
              </div>
              <h3 className="font-bold text-gray-800 text-lg mb-2">{channel.title}</h3>
              <p className="text-gray-500 text-sm mb-6 flex-1">{channel.description}</p>
              <a
                href={channel.actionUrl}
                target={channel.actionUrl.startsWith("http") ? "_blank" : undefined}
                rel={channel.actionUrl.startsWith("http") ? "noreferrer" : undefined}
                className="inline-block w-full py-2.5 rounded-xl font-bold text-sm transition-colors border bg-white text-gray-800 border-gray-200 hover:bg-gray-50"
              >
                {channel.actionText}
              </a>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
        <div className="bg-brand-blue/5 rounded-2xl p-8 border border-gray-100 flex flex-col justify-center">
          <h3 className="font-bold text-gray-800 text-xl mb-4 flex items-center gap-2">
            <Clock className="text-brand-blue" size={24} />
            Operating Hours
          </h3>
          {hours.length === 0 ? (
            <p className="text-gray-500 text-sm italic">Operating hours aren&apos;t configured yet.</p>
          ) : (
            <ul className="space-y-4 text-gray-600">
              {hours.map((h: any, i: number) => (
                <li key={i} className="flex justify-between items-center pb-4 border-b border-gray-200">
                  <span className="font-semibold">{h.days}:</span>
                  <span>{h.time}</span>
                </li>
              ))}
              <li className="flex justify-between items-center text-sm text-gray-500 mt-2">
                <span className="italic">* Live chat and calls are available during operating hours only.</span>
              </li>
            </ul>
          )}
        </div>

        <div className="bg-brand-blue/5 rounded-2xl p-8 border border-gray-100">
          <h3 className="font-bold text-gray-800 text-xl mb-6 flex items-center gap-2">
            <MapPin className="text-brand-blue" size={24} />
            Corporate Office
          </h3>
          <div className="text-gray-600 space-y-2">
            {address ? (
              <>
                {address.split(",").map((line, i) => <p key={i}>{line.trim()}</p>)}
              </>
            ) : (
              <p className="italic text-gray-400">Address not configured.</p>
            )}
          </div>

          <div className="mt-8">
            {mapEmbedSrc ? (
              <iframe
                title="Store location map"
                src={mapEmbedSrc}
                className="w-full h-48 rounded-xl border border-gray-300"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            ) : (
              <p className="text-gray-500 text-sm italic">A map will appear here once a store address or map link is configured.</p>
            )}
          </div>
        </div>
      </div>

      <SupportEnquiryForm />
    </div>
  );
}
