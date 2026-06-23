export default function LandingFooter() {
  return (
    <footer className="bg-gray-900 text-gray-400 py-10">
      <div className="max-w-6xl mx-auto px-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* Logo / Brand */}
          <div className="text-center md:text-left">
            <p className="text-white font-bold text-lg">EcoMate</p>
            <p className="text-xs mt-1 max-w-xs">
              Premium products delivered across Bangladesh.
            </p>
          </div>

          {/* Contact */}
          <div className="text-center md:text-right">
            <p className="text-white text-sm font-medium">Contact Us</p>
            <p className="text-xs mt-1">WhatsApp: 01XXXXXXXXX</p>
            <p className="text-xs">Email: support@example.com</p>
          </div>

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
            &copy; {new Date().getFullYear()} EcoMate. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
