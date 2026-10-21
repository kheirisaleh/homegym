import { useState } from "react";
import { Link } from "react-router";
import { api } from "@/lib/api";
import { EXPERIENCE_NAMES, GOAL_NAMES, MUSCLE_NAMES, shortMuscleName } from "@/lib/catalog";
import { num } from "@/lib/format";
import type { User } from "@/lib/types";
import { useResource } from "@/lib/useResource";
import { Page } from "@/app/Page";
import { logout } from "@/app/session";
import { setUser } from "@/app/state";
import { deleteAccount, ProfileFields, profileDraft, saveProfile, TrainingBrief } from "@/features/coachTools";
import { rebuildDialog } from "@/features/programDialogs";
import { BodyModel } from "@/three/BodyModel";
import { Avatar } from "@/ui/common";

export function goalLine(user: User): string {
  return (GOAL_NAMES[user.goal] ?? user.goal) + ", " + String(user.days_per_week) + " days a week, level " + user.level;
}

export function priorityText(user: User): string {
  return user.priority_muscles.map(shortMuscleName).join(", ") || "balanced";
}

function ProfileView({ user }: { user: User }) {
  const [draft, setDraft] = useState(() => profileDraft(user));
  return (
    <>
      <div className="page-head">
        <div className="profile-head">
          <Avatar name={user.name} color={user.color} size="big" />
          <div>
            <h1>{user.name}</h1>
            <p className="muted">{goalLine(user)}</p>
          </div>
        </div>
        <div className="page-actions">
          <Link className="btn" to="/trainer">
            My coach
          </Link>
          <button type="button" className="btn" onClick={() => void rebuildDialog()}>
            New program with your coach
          </button>
          <button type="button" className="btn primary" onClick={logout}>
            Log out
          </button>
        </div>
      </div>
      <div className="profile-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Profile</h2>
          </div>
          <ProfileFields draft={draft} onChange={setDraft} mobile={false} />
          <div className="profile-facts">
            <div>
              <span>Sex</span>
              <b>{user.sex}</b>
            </div>
            <div>
              <span>Experience</span>
              <b>{EXPERIENCE_NAMES[user.experience] ?? ""}</b>
            </div>
            <div>
              <span>BMI</span>
              <b>{user.bmi ? num(user.bmi) + " (" + user.bmi_label + ")" : "–"}</b>
            </div>
            <div>
              <span>Target muscles</span>
              <b>{priorityText(user)}</b>
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn ghost danger left" onClick={() => void deleteAccount(user)}>
              Delete account
            </button>
            <button type="button" className="btn primary" onClick={() => void saveProfile(draft)}>
              Save profile
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-head">
            <h2>Your muscles</h2>
            <span className="hint">Change priorities under Coach</span>
          </div>
          <BodyModel className="model-box profile-model" sex={user.sex} selected={user.priority_muscles} interactive={false} autoRotate labels={MUSCLE_NAMES} />
        </section>
      </div>
      {user.plan_summary ? (
        <section className="panel profile-section">
          <div className="panel-head">
            <h2>Coach summary of your first program</h2>
          </div>
          <p>{user.plan_summary}</p>
        </section>
      ) : null}
      <section className="panel flat profile-section">
        <div className="panel-head">
          <h2>Training brief</h2>
          <span className="hint">What the AI coach received</span>
        </div>
        <div className="report">
          <TrainingBrief />
        </div>
      </section>
    </>
  );
}

export function ProfilePage() {
  const resource = useResource(async (signal) => {
    const user = await api.get<User>("/api/me", { signal });
    setUser(user);
    return user;
  }, [], ["user"]);
  return (
    <Page ready={Boolean(resource.data)} error={resource.error} onRetry={resource.reload}>
      {() => resource.data && <ProfileView key={resource.data.id} user={resource.data} />}
    </Page>
  );
}
