// Curated, versioned public knowledge. Only approved facts belong here.
export const NISCO_KNOWLEDGE_VERSION = "2026-11-11";
const entries = [
  { id:"identity", keywords:/\b(about nisco|what is nisco|who are you|company|about your company)\b|من هي نيسكو|عن نيسكو|ما هي نيسكو/i,
    en:"NISCO is a Chennai, India-based business services and digital solutions provider. Its brand promise is “Built to Rise. Driven to Grow.”",
    ar:"نيسكو شركة مقرها تشيناي في الهند، وتقدم خدمات الأعمال والحلول الرقمية. شعارها: «نبني لنرتقي، وندفعك نحو النمو»." },
  { id:"services", keywords:/\b(services|what do you do|what can you help|offerings)\b|الخدمات|ماذا تقدمون|ماذا تفعلون/i,
    en:"NISCO works across digital marketing; business websites, web apps and e-commerce; business process and workflow automation, reporting and Power BI; AI chatbots; and selected business/trading enquiries such as real-estate-related services and cattle-feed/livestock supplies, subject to availability and applicable authorisations.",
    ar:"تقدم نيسكو خدمات التسويق الرقمي، وتطوير مواقع الأعمال وتطبيقات الويب والتجارة الإلكترونية، وأتمتة العمليات وسير العمل والتقارير وPower BI، وروبوتات المحادثة بالذكاء الاصطناعي، إضافة إلى استفسارات مختارة عن خدمات الأعمال والتجارة مثل الخدمات المرتبطة بالعقارات ومستلزمات الأعلاف والثروة الحيوانية، وفق التوفر والتصاريح النظامية." },
  { id:"pricing", keywords:/\b(price|pricing|cost|how much|starting price|charges|budget)\b|الأسعار|السعر|التكلفة|كم يكلف|كم السعر/i,
    en:"Approved indicative India starting prices (INR): business website ₹15,000 onwards; business automation ₹15,000 onwards; AI chatbot ₹10,000 onwards; website maintenance ₹2,000/month onwards; automation support ₹3,000/month onwards. Digital marketing and other services are quoted after understanding requirements. These are starting prices, not fixed quotations. Domain, hosting, paid licences, third-party subscriptions, taxes and advertising spend are excluded unless stated in a written quotation.",
    ar:"الأسعار الاسترشادية المعتمدة في الهند (بالروبية الهندية): موقع الأعمال يبدأ من 15,000 روبية؛ أتمتة الأعمال من 15,000 روبية؛ روبوت المحادثة بالذكاء الاصطناعي من 10,000 روبية؛ صيانة الموقع من 2,000 روبية شهرياً؛ ودعم الأتمتة من 3,000 روبية شهرياً. تُحدد أسعار التسويق الرقمي والخدمات الأخرى بعد فهم المتطلبات. هذه أسعار بداية وليست عروضاً نهائية، ولا تشمل النطاق أو الاستضافة أو التراخيص أو الاشتراكات الخارجية أو الضرائب أو الإنفاق الإعلاني ما لم يُذكر ذلك في عرض مكتوب." },
  { id:"contact", keywords:/\b(contact|email address|speak to someone|human|reach you)\b|تواصل|البريد الإلكتروني|موظف|شخص/i,
    en:"You can contact NISCO at nisco.in@outlook.com. NISCO does not publish a public phone or WhatsApp number.",
    ar:"يمكنك التواصل مع نيسكو عبر البريد الإلكتروني nisco.in@outlook.com. لا تنشر نيسكو رقم هاتف أو واتساب عاماً." },
  { id:"location", keywords:/\b(where are you|location|based in|which city)\b|أين|الموقع|مقر|المدينة/i,
    en:"NISCO is based in Chennai, India and can discuss suitable remote projects with businesses across India.",
    ar:"يقع مقر نيسكو في تشيناي، الهند، ويمكنها مناقشة المشاريع المناسبة عن بُعد مع الشركات في مختلف أنحاء الهند." },
  { id:"process", keywords:/\b(how does it work|process|next steps|quotation|proposal|timeline)\b|كيف تعمل|الخطوات|عرض سعر|المدة|الجدول الزمني/i,
    en:"The usual next step is to understand your business, goals, required features, integrations and preferred timeline. NISCO then reviews the scope and confirms availability, price and delivery expectations in a written proposal. No delivery date or final quote is guaranteed before that review.",
    ar:"الخطوة التالية عادةً هي فهم نشاطك وأهدافك والميزات المطلوبة والتكاملات والمدة المفضلة. بعد ذلك تراجع نيسكو نطاق العمل وتؤكد التوفر والسعر وتوقعات التسليم في عرض مكتوب. لا يتم ضمان موعد التسليم أو السعر النهائي قبل هذه المراجعة." },
  { id:"privacy", keywords:/\b(privacy|personal data|save my details|delete my data|consent)\b|الخصوصية|بياناتي|حذف البيانات|الموافقة/i,
    en:"NISCO only saves a chatbot enquiry after you provide an email or phone number and explicitly agree to share it with the NISCO team. You can decline; the enquiry will not be saved. Do not send passwords, payment-card details or government IDs.",
    ar:"لا تحفظ نيسكو استفسار المحادثة إلا بعد تقديم بريد إلكتروني أو رقم هاتف والموافقة الصريحة على مشاركته مع فريق نيسكو. يمكنك الرفض ولن يُحفظ الاستفسار. يرجى عدم إرسال كلمات المرور أو بيانات البطاقات البنكية أو أرقام الهوية الحكومية." }
];
export function lookupNiscoKnowledge(message) {
  const entry = entries.find(item => item.keywords.test(String(message || "")));
  if (!entry) return null;
  const isArabic = /[؀-ۿ]/.test(message);
  return { answer: isArabic ? entry.ar : entry.en, source: entry.id, version: NISCO_KNOWLEDGE_VERSION };
}
