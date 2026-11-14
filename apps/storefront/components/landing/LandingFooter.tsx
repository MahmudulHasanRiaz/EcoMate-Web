import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";

// Landing footer. Contact data is bound to the storefront config —
// blank-is-invisible: when the store has not set a phone/email, the
// contact lines (and the whole Contact block) render nothing, never a
// dummy like 01XXXXXXXXX / support@example.com.
export default async function LandingFooter() {
  const config = await getStorefrontConfigServer().catch(() => null);
  const storeName = config?.store?.name || "EcoMate";
  const tagline = config?.store?.tagline || "";
  const phone = config?.store?.phone?.trim() || "";
  const email = config?.store?.email?.trim() || "";
  const hasContact = Boolean(phone || email);

  return (
    <footer className="bg-gray-900 text-gray-400 py-10">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo / Brand */}
          <div className="text-center md:text-left">
            <p className="text-white font-bold text-lg">{storeName}</p>
            {tagline ? (
              <p className="text-xs mt-1 max-w-xs">{tagline}</p>
            ) : null}
          </div>

          {/* Contact — renders nothing at all when unset */}
          {hasContact && (
            <div className="text-center md:text-right">
              <p className="text-white text-sm font-medium">Contact Us</p>
              {phone ? <p className="text-xs mt-1">WhatsApp: {phone}</p> : null}
              {email ? <p className="text-xs">Email: {email}</p> : null}
            </div>
          )}

          {/* Payment icons */}
          <div className="flex items-center gap-3">
            {['COD', 'bKash', 'Nagad', 'VISA'].map(method => (
              <span key={method} className="bg-gray-800 text-gray-300 text-[10px] font-bold px-2.5 py-1.5 rounded">
                {method}
              </span>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-6 text-center">
          <p className="text-xs text-gray-600">
            &copy; {new Date().getFullYear()} {storeName}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
