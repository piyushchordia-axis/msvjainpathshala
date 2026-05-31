import { useLocale } from "@/contexts/LocaleContext";
import { PersonaTabs } from "@/components/PersonaTabs";

export default function Layout() {
  const { hi } = useLocale();
  return (
    <PersonaTabs
      allowed={["shikshak"]}
      tabs={[
        { name: "today", title: hi ? "आज" : "Today", icon: "today" },
        { name: "students", title: hi ? "विद्यार्थी" : "Students", icon: "people" },
        { name: "batches", title: hi ? "बैच" : "Batches", icon: "grid" },
        { name: "niyams", title: hi ? "नियम" : "Niyams", icon: "sparkles" },
        { name: "profile", title: hi ? "प्रोफ़ाइल" : "Profile", icon: "person-circle" },
      ]}
    />
  );
}
