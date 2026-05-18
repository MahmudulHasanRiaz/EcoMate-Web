import { Truck } from "lucide-react";

export default function ShippingPolicyPage() {
  return (
    <div className="max-w-screen-xl mx-auto px-3 md:px-4 py-4 md:py-8">
      <h1 className="text-[18px] md:text-[24px] font-bold text-gray-900 mb-1">Shipping Policy</h1>
      <p className="text-[13px] text-gray-500 mb-6">Last updated: December 2024</p>
      <div className="max-w-3xl space-y-4 text-[13px] text-gray-600">
        <p>At Fixed Plus, we strive to deliver your orders as quickly and safely as possible.</p>
        <h3 className="text-[15px] font-semibold text-gray-800">Processing Time</h3>
        <p>Orders are processed within 24 hours of placement (excluding Fridays and public holidays).</p>
        <h3 className="text-[15px] font-semibold text-gray-800">Delivery Timeframes</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li><strong>Inside Dhaka:</strong> 24-48 hours</li>
          <li><strong>Outside Dhaka (City areas):</strong> 3-5 business days</li>
          <li><strong>Other districts:</strong> 5-7 business days</li>
        </ul>
        <h3 className="text-[15px] font-semibold text-gray-800">Shipping Charges</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>Free shipping on orders over ৳5,000</li>
          <li>Inside Dhaka: ৳60 flat rate</li>
          <li>Outside Dhaka: ৳100-300 depending on location</li>
        </ul>
        <h3 className="text-[15px] font-semibold text-gray-800">Order Tracking</h3>
        <p>Once shipped, you will receive a tracking ID via SMS to track your order.</p>
      </div>
    </div>
  );
}
