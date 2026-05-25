import type { Metadata } from "next";
import { Phone, Mail, MessageCircle, MapPin, HeadphonesIcon, Clock, MessagesSquare } from 'lucide-react';

export const metadata: Metadata = {
  title: "Support — Fixed Plus",
  description: "Contact Fixed Plus customer support via phone, WhatsApp, live chat, or email. We are here to help.",
};

export default function SupportPage() {
  const supportChannels = [
    {
      icon: <Phone size={24} />,
      title: "Call Us",
      description: "Speak with our friendly customer service team directly.",
      actionText: "+880 123 456 7890",
      actionUrl: "tel:+8801234567890",
      bgColor: "bg-blue-50",
      iconColor: "text-blue-500"
    },
    {
      icon: <MessageCircle size={24} />,
      title: "WhatsApp Chat",
      description: "Message us on WhatsApp for quick responses and updates.",
      actionText: "Chat on WhatsApp",
      actionUrl: "#",
      bgColor: "bg-green-50",
      iconColor: "text-green-500"
    },
    {
      icon: <MessagesSquare size={24} />,
      title: "Live Chat",
      description: "Chat with an agent right now from the website.",
      actionText: "Start Live Chat",
      actionUrl: "#",
      bgColor: "bg-purple-50",
      iconColor: "text-purple-500"
    },
    {
      icon: <Mail size={24} />,
      title: "Email Support",
      description: "Send us an email anytime and we will get back to you within 24 hours.",
      actionText: "support@fixedplus.com",
      actionUrl: "mailto:support@fixedplus.com",
      bgColor: "bg-brand-blue/10",
      iconColor: "text-brand-blue"
    }
  ];

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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-16">
        {supportChannels.map((channel, index) => (
          <div key={index} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow text-center flex flex-col h-full">
            <div className={`w-14 h-14 mx-auto rounded-full ${channel.bgColor} ${channel.iconColor} flex items-center justify-center mb-4`}>
              {channel.icon}
            </div>
            <h3 className="font-bold text-gray-800 text-lg mb-2">{channel.title}</h3>
            <p className="text-gray-500 text-sm mb-6 flex-1">{channel.description}</p>
            <a 
              href={channel.actionUrl}
              className={`inline-block w-full py-2.5 rounded-xl font-bold text-sm transition-colors border ${
                index === 3 
                ? 'bg-brand-blue text-white border-brand-blue hover:bg-brand-blue/90' 
                : 'bg-white text-gray-800 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {channel.actionText}
            </a>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="bg-[#f8f9fa] rounded-2xl p-8 border border-gray-100 flex flex-col justify-center">
          <h3 className="font-bold text-gray-800 text-xl mb-4 flex items-center gap-2">
            <Clock className="text-brand-blue" size={24} />
            Operating Hours
          </h3>
          <ul className="space-y-4 text-gray-600">
            <li className="flex justify-between items-center pb-4 border-b border-gray-200">
              <span className="font-semibold">Saturday - Thursday:</span>
              <span>10:00 AM - 10:00 PM</span>
            </li>
            <li className="flex justify-between items-center pb-4 border-b border-gray-200">
              <span className="font-semibold">Friday:</span>
              <span>3:00 PM - 10:00 PM</span>
            </li>
            <li className="flex justify-between items-center text-sm text-gray-500 mt-2">
              <span className="italic">* Live chat and calls are available during operating hours only.</span>
            </li>
          </ul>
        </div>

        <div className="bg-[#f8f9fa] rounded-2xl p-8 border border-gray-100">
          <h3 className="font-bold text-gray-800 text-xl mb-6 flex items-center gap-2">
            <MapPin className="text-brand-blue" size={24} />
            Corporate Office
          </h3>
          <div className="text-gray-600 space-y-2">
            <p className="font-bold text-gray-800">Fixed Plus Ltd.</p>
            <p>House: 15, Road: 2, Block: A</p>
            <p>Mirpur 10, Dhaka - 1216</p>
            <p>Bangladesh</p>
          </div>
          
          <div className="mt-8">
            <div className="w-full h-48 bg-gray-200 rounded-xl overflow-hidden relative border border-gray-300">
              <div className="absolute inset-0 flex items-center justify-center flex-col text-gray-500">
                 <MapPin size={32} className="mb-2 text-gray-400" />
                 <span className="font-medium">Map integration would go here</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
