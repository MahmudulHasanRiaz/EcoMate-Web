import type { ComponentType } from "react";
import CareersTemplate from "./pages/careers";
import AboutTemplate from "./pages/about";
import CompanyTemplate from "./pages/company";
import FaqTemplate from "./pages/faq";
import ContactTemplate from "./pages/contact";
import StoresTemplate from "./pages/stores";
import DeliveryAreasTemplate from "./pages/delivery-areas";
import TermsConditionsTemplate from "./pages/terms-conditions";
import PrivacyPolicyTemplate from "./pages/privacy-policy";
import RefundPolicyTemplate from "./pages/refund-policy";
import ExchangePolicyTemplate from "./pages/exchange-policy";
import ShippingPolicyTemplate from "./pages/shipping-policy";
import DownloadTemplate from "./pages/download";

export interface PreFormattedPageDefinition {
  slug: string;
  title: string;
  description: string;
  defaultConfig: Record<string, any>;
  component: ComponentType<{ config: Record<string, any> }>;
}

export const preFormattedPages: Record<string, PreFormattedPageDefinition> = {
  careers: {
    slug: "careers",
    title: "Careers",
    description: "Open positions, benefits, and how to apply.",
    defaultConfig: {
      hero: { title: "WE ARE HIRING.", subtitle: "Join a team that cares about health, authenticity, and the growth of Bangladeshi agriculture.", image: "" },
      jobs: [
        { title: "Senior Food Quality Inspector", department: "Quality Control", location: "Dhaka (Mirpur Hub)", type: "Full-time", salary: "৳ 45,000 - 60,000", description: "" },
        { title: "Supply Chain Coordinator", department: "Logistics", location: "Gazipur Warehouse", type: "Full-time", salary: "৳ 35,000 - 45,000", description: "" },
        { title: "Content Writer (Food & Health)", department: "Marketing", location: "Remote / Hybrid", type: "Part-time / Contract", salary: "Competitive", description: "" },
        { title: "Customer Success Lead", department: "Operations", location: "Dhaka", type: "Full-time", salary: "৳ 30,000 - 40,000", description: "" },
      ],
      benefits: ["Health Insurance", "Performance Bonus", "Learning Subsidies", "Flexible Hours"],
      application: { email: "", ctaText: "Send Spontaneous CV" },
    },
    component: CareersTemplate,
  },
  about: {
    slug: "about",
    title: "About Us",
    description: "Our story, values, and mission.",
    defaultConfig: {
      story:
        "Started with a mission to bring excellence in every interaction.\n\n" +
        "Store was born from a simple realization: the market lacked high-quality, reliable technology and household solutions. We wanted to bridge the gap between innovation and consumer needs.\n\n" +
        "Our journey began in 2024 with a vision to redefine reliability. Today, we have grown into a multi-vertical platform serving thousands of customers across the nation.\n\n" +
        "Every solution we offer goes through extensive testing. We don't just provide products; we provide confidence.",
      values: [
        { title: "Uncompromising Tech", description: "We leverage the latest engineering standards to ensure high-performance reliability." },
        { title: "Precision Focused", description: "Eliminating inefficiencies to ensure our customers get the best value and accuracy." },
        { title: "Innovation Driven", description: "Your needs drive our R&D. We build what the future requires today." },
      ],
      image: "",
    },
    component: AboutTemplate,
  },
  company: {
    slug: "company",
    title: "Company",
    description: "Corporate details, certifications, and leadership.",
    defaultConfig: {
      name: "Store Limited",
      registration: "C-182394/2021",
      certifications: "BSTI Certified",
      teamSize: "150+ Experts",
      ceoName: "Mahmud Riaz",
      established: "2024",
      philosophy:
        "At Store, we believe that transparency is the bedrock of trust. From the early stages of development to the final product delivery, we manage every step with integrity.",
      vision: "Empowering millions through cutting-edge technology and reliable services.",
      impact: "Simplifying complex technology for the modern Bangladeshi household.",
      image: "",
    },
    component: CompanyTemplate,
  },
  faq: {
    slug: "faq",
    title: "FAQ",
    description: "Frequently asked questions and answers.",
    defaultConfig: {
      items: [
        { question: "How do I place an order?", answer: "You can easily place an order through our website by adding items to your cart and proceeding to checkout." },
        { question: "What are the payment methods available?", answer: "We accept multiple payment methods including Cash on Delivery (COD), Mobile Banking, and Credit/Debit Cards." },
        { question: "How long does delivery take?", answer: "Inside Dhaka, delivery usually takes 1-2 business days. Outside Dhaka, it may take 3-5 business days." },
        { question: "What is your return policy?", answer: "If you receive a damaged or incorrect product, you can request a return within 3 days of receiving the order." },
        { question: "Are your products authentic?", answer: "Yes, 100% authentic. We carefully source all our products from verified suppliers." },
        { question: "How can I track my order?", answer: "You can track your order by entering your order ID or mobile number on the Track Order page." },
      ],
    },
    component: FaqTemplate,
  },
  contact: {
    slug: "support",
    title: "Contact / Support",
    description: "Support phone, email, address, and hours.",
    defaultConfig: {
      phone: "",
      email: "",
      address: "",
      whatsapp: "",
      hours: [
        { days: "Saturday - Thursday", time: "10:00 AM - 10:00 PM" },
        { days: "Friday", time: "3:00 PM - 10:00 PM" },
      ],
    },
    component: ContactTemplate,
  },
  stores: {
    slug: "stores",
    title: "Stores",
    description: "Physical store locations, hours, and map links.",
    defaultConfig: {
      stores: [
        {
          name: "Store Warehouse • Dhaka",
          address: "Level 6, Block D, Shop 63-64, Bashundhara City Shopping Mall, Dhaka",
          phone: "",
          hours: "Sat - Thu: 9 AM - 9 PM",
          mapLink: "https://maps.app.goo.gl/mT4GwfLr9AE6SFqS8",
          comingSoon: false,
        },
        {
          name: "Chittagong Store",
          address: "We are expanding! Our second location is coming soon to Chittagong. Stay tuned for updates.",
          phone: "",
          hours: "",
          mapLink: "",
          comingSoon: true,
        },
        {
          name: "Sylhet Store",
          address: "We are expanding! Our third location is coming soon to Sylhet. Stay tuned for updates.",
          phone: "",
          hours: "",
          mapLink: "",
          comingSoon: true,
        },
      ],
    },
    component: StoresTemplate,
  },
  "delivery-areas": {
    slug: "delivery-areas",
    title: "Delivery Areas",
    description: "Delivery zones, charges, and timeframes.",
    defaultConfig: {
      areas: [
        { zone: "Inside Dhaka", areas: ["Gulshan", "Banani", "Uttara", "Mirpur", "Mohammadpur", "Dhanmondi", "Motijheel", "Farmgate", "Bashundhara", "Baridhara"], charge: "Free", deliveryTime: "24-48 hours" },
        { zone: "Outside Dhaka", areas: ["Chittagong City", "Sylhet City", "Rajshahi City", "Khulna City", "Barisal City", "Rangpur City", "Mymensingh City"], charge: "৳100-200", deliveryTime: "3-5 business days" },
        { zone: "Other Districts", areas: ["All district headquarters across Bangladesh"], charge: "৳150-300", deliveryTime: "5-7 business days" },
      ],
      freeDeliveryMin: 0,
    },
    component: DeliveryAreasTemplate,
  },
  "terms-conditions": {
    slug: "terms-conditions",
    title: "Terms & Conditions",
    description: "Terms of service document.",
    defaultConfig: {
      sections: [
        { heading: "1. Acceptance of Terms", body: "FIXED PLUS LTD provides its service to you, subject to the following Terms of Service, which may be updated by us from time to time without notice to you. You can review the most current version of the Terms of Service at any time on this page." },
        { heading: "2. Product Authenticity", body: "We guarantee the authenticity of our signature items including pure honey, ghee, and organic oils. However, as these are natural products, seasonal variations in color, texture, and taste are normal and do not qualify as defects." },
        { heading: "3. Use of Website", body: "You may use the website for personal, non-commercial purposes only. Any unauthorized use of automated systems or software to extract data from this website for commercial purposes ('screen scraping') is strictly prohibited." },
        { heading: "Termination of Service", body: "We reserve the right to refuse service to anyone for any reason at any time. We may also, in our sole discretion, change or discontinue any aspect, service or feature of the website, including, but not limited to, content, hours of availability, and equipment needed for access or use." },
      ],
    },
    component: TermsConditionsTemplate,
  },
  "privacy-policy": {
    slug: "privacy-policy",
    title: "Privacy Policy",
    description: "Privacy and data handling policy.",
    defaultConfig: {
      sections: [
        { heading: "Data Collection", body: "We only collect essential information needed to fulfill your orders: name, shipping address, mobile number, and email. We do not store sensitive payment details like credit card numbers; these are handled by secured 3rd party gateways." },
        { heading: "Usage Disclosure", body: "Your data is primarily used to process transactions, send delivery updates, and occasionally inform you about new products or offers. We never sell your personal information to third-party marketing agencies." },
        { heading: "Security Architecture", body: "Our platform uses industry-standard SSL encryption for all data transfers. We conduct periodic security audits to ensure your data remains protected against unauthorized access or breaches." },
        { heading: "User Rights", body: "You have the right to request access to the personal data we hold about you at any time.\n\nYou may request the deletion of your account and all associated personal data from our servers.\n\nYou can opt-out of marketing communications by clicking 'Unsubscribe' in our emails.\n\nIf you have any privacy concerns, contact our Data Privacy Officer via email." },
      ],
    },
    component: PrivacyPolicyTemplate,
  },
  "refund-policy": {
    slug: "refund-policy",
    title: "Refund Policy",
    description: "Returns, refunds, and eligibility.",
    defaultConfig: {
      sections: [
        { heading: "Eligibility for Refund", body: "To be eligible for a refund, the product must be in the same condition that you received it, unworn or unused, with tags, and in its original packaging. You'll also need the receipt or proof of purchase." },
        { heading: "Reason for Refund", body: "Received a damaged product upon delivery.\n\nReceived a product that is past its expiration date.\n\nReceived the wrong item entirely.\n\nThe quality of the product does not match the description provided." },
        { heading: "Refund Timeline", body: "Once we receive and inspect your return, we will notify you of the approval or rejection of your refund. If approved, the refund will be processed within 5-7 business days through your original payment method (bKash, Nagad, or Bank Transfer)." },
      ],
      contactEmail: "",
    },
    component: RefundPolicyTemplate,
  },
  "exchange-policy": {
    slug: "exchange-policy",
    title: "Exchange Policy",
    description: "Product exchange conditions.",
    defaultConfig: {
      sections: [
        { heading: "Request Exchange", body: "Contact our support within 24 hours of delivery to initiate the process." },
        { heading: "Return Shipping", body: "Our courier will pick up the item or you can ship it back to our hub." },
        { heading: "Quality Check", body: "We inspect the returned item to ensure it's in original condition." },
        { heading: "Original Packaging", body: "The item must be returned in its original Store packaging." },
        { heading: "Proof of Purchase", body: "A valid order ID or paper invoice must be presented." },
        { heading: "Non-Food Items", body: "Food items can only be exchanged if damaged; non-food items follow standard rules." },
        { heading: "Shipping Costs", body: "Standard shipping charges apply for exchanges unless the error was on our part." },
      ],
    },
    component: ExchangePolicyTemplate,
  },
  "shipping-policy": {
    slug: "shipping-policy",
    title: "Shipping Policy",
    description: "Shipping times, charges, and delivery information.",
    defaultConfig: {
      sections: [
        { heading: "", body: "At Store, we strive to deliver your orders as quickly and safely as possible." },
        { heading: "Processing Time", body: "Orders are processed within 24 hours of placement (excluding Fridays and public holidays)." },
        { heading: "Delivery Timeframes", body: "Inside Dhaka: 24-48 hours\n\nOutside Dhaka (City areas): 3-5 business days\n\nOther districts: 5-7 business days" },
        { heading: "Shipping Charges", body: "Free shipping on orders over ৳5,000\n\nInside Dhaka: ৳60 flat rate\n\nOutside Dhaka: ৳100-300 depending on location" },
        { heading: "Order Tracking", body: "Once shipped, you will receive a tracking ID via SMS to track your order." },
      ],
      deliveryCharge: 60,
      freeDeliveryMin: 5000,
    },
    component: ShippingPolicyTemplate,
  },
  download: {
    slug: "download",
    title: "Download App",
    description: "Mobile app download links and features.",
    defaultConfig: {
      androidUrl: "",
      iosUrl: "",
      heading: "Get the Store App",
      description:
        "Install our app for a faster, more convenient shopping experience. Access exclusive deals, track orders in real-time, and enjoy seamless checkout — right from your phone.",
      image: "",
      features: ["Faster Checkout", "Order Tracking", "Secure & Private"],
    },
    component: DownloadTemplate,
  },
};
