import { useLocale } from "@/contexts/LocaleContext";
import { PersonaTabs } from "@/components/PersonaTabs";
import { ADMIN_ROLES } from "@/lib/roles";

export default function Layout() {
  const { hi } = useLocale();
  return (
    <PersonaTabs
      allowed={ADMIN_ROLES}
      hide={["centres", "shikshaks", "holidays", "notices", "niyam-review", "attendance", "service-requests", "homework", "gallery", "reports", "courses", "course/[id]"]}
      tabs={[
        { name: "dashboard", title: hi ? "डैशबोर्ड" : "Dashboard", icon: "stats-chart" },
        { name: "students", title: hi ? "विद्यार्थी" : "Students", icon: "people" },
        { name: "enrolments", title: hi ? "नामांकन" : "Enrolments", icon: "clipboard" },
        { name: "batches", title: hi ? "बैच" : "Batches", icon: "grid" },
        { name: "profile", title: hi ? "प्रोफ़ाइल" : "Profile", icon: "person-circle" },
      ]}
    />
  );
}
