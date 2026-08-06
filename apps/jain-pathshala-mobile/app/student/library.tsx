import { LibraryView } from "@/components/LibraryView";
import { ProfileAvatarButton } from "@/components/AppHeader";
import { useAuth } from "@/contexts/AuthContext";
import { useSessionView } from "@/contexts/SessionViewContext";

export default function StudentLibrary() {
  const { user } = useAuth();
  const { activeChild } = useSessionView();

  return (
    <LibraryView
      headerRight={
        <ProfileAvatarButton
          name={activeChild?.full_name ?? user?.full_name}
          photoUrl={activeChild?.photo_url}
          href="/student/profile"
        />
      }
    />
  );
}
