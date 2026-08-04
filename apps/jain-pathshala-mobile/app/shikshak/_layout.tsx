import { useLocale } from "@/contexts/LocaleContext";
import { PersonaTabs } from "@/components/PersonaTabs";

export default function Layout() {
  const { hi } = useLocale();
  return (
    <PersonaTabs
      allowed={["shikshak"]}
      hide={["niyams", "niyam-review"]}
      tabs={[
        { name: "today", title: hi ? "आज" : "Today", icon: "today" },
        { name: "students", title: hi ? "विद्यार्थी" : "Students", icon: "people" },
        { name: "batches", title: hi ? "बैच" : "Batches", icon: "grid" },
        { name: "homework", title: hi ? "गृहकार्य" : "Homework", icon: "book" },
        { name: "profile", title: hi ? "प्रोफ़ाइल" : "Profile", icon: "person-circle" },
      ]}
    />
  );
}
