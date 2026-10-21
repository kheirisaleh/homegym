import { Page } from "@/app/Page";
import { type HealthHeaderProps, HealthView } from "@/features/cycle";
import { PageHead } from "@/ui/common";

function Header({ lock }: HealthHeaderProps) {
  return (
    <PageHead
      title="Health"
      lead="Your cycle, symptoms and training in one place. Private to you."
      actions={
        lock ? (
          <button type="button" className="btn" onClick={lock}>
            Lock
          </button>
        ) : null
      }
    />
  );
}

export function HealthPage() {
  return (
    <Page ready>
      {() => (
        <HealthView Header={Header} home="/" bodyClassName="cycle-desktop health-desktop" />
      )}
    </Page>
  );
}
