import { Page } from "@/app/Page";
import { AdminSettings } from "@/features/AdminSettings";
import { PageHead } from "@/ui/common";

export function SettingsPage() {
  return (
    <Page ready>
      {() => (
        <>
          <PageHead title="Settings" lead="Server settings for the whole gym. Values set here win over the server file." />
          <AdminSettings />
        </>
      )}
    </Page>
  );
}
