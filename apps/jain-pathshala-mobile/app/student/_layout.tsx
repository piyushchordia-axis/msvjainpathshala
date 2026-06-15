import { useLocale } from "@/contexts/LocaleContext";
import { PersonaTabs } from "@/components/PersonaTabs";

export default function Layout() {
  const { hi } = useLocale();
  return (
    <PersonaTabs
      allowed={["student"]}
      tabs={[
        { name: "home", title: hi ? "मुख" : "Home", icon: "home" },
        { name: "punya", title: hi ? "पुण्य" : "Punya", icon: "ribbon" },
        { name: "niyams", title: hi ? "नियम" : "Niyams", icon: "sparkles" },
        { name: "library", title: hi ? "पुस्तकालय" : "Library", icon: "library" },
        { name: "profile", title: hi ? "प्रोफ़ाइल" : "Profile", icon: "person-circle" },
      ]}
    />
  );
}
