import { Page } from "@/app/Page";
import { TrainerSettings } from "@/features/coachTools";
import { PageHead } from "@/ui/common";

export function TrainerPage() {
  return (
    <Page ready>
      {() => (
        <>
          <PageHead title="My coach" lead="Your coach briefs you before every workout, debriefs you after it and reviews your program twice a week at night." />
          <TrainerSettings mobile={false} />
        </>
      )}
    </Page>
  );
}
