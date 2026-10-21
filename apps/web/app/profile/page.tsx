"use client";

import Link from "next/link";
import { useChog } from "../../components/chog-provider";
import { Icon } from "../../components/icons";
import { AccountNavigation } from "../../components/site-shell";
import {
  ClaimList,
  DiscoverButton,
  Notice,
  PageHeader,
  ProfileGate,
  ProfileArtwork,
  ProfilePicker,
  ProfileTraits,
  Progress,
} from "../../components/ui";
import { XProfileLink } from "../../components/x-link";
import { TraitInventory } from "../../components/trait-inventory";
import { titleCase } from "../../lib/api";

export default function ProfilePage() {
  const {
    profile,
    claims,
    claimError,
    address,
    signedIn,
    signOut,
    refreshData,
  } = useChog();
  const profileClaims = claims.filter(
    (claim) => claim.profileId === profile?.id,
  );
  const accepted = profileClaims.filter(
    (claim) => claim.status === "accepted" && claim.finalized !== false,
  );
  return (
    <main id="main-content" className="product-page section-width">
      <AccountNavigation />
      <PageHeader
        eyebrow="YOUR CORNER OF THE CHOG WORLD"
        title="Looking good, Chog."
        description="All your little victories. One very individual little creature."
      >
        <ProfilePicker />
      </PageHeader>
      <ProfileGate>
        {profile && (
          <>
            <section
              className="profile-showcase"
              aria-labelledby="profile-name"
            >
              <ProfileArtwork profile={profile} />
              <div className="profile-summary">
                <div className="profile-title-line">
                  <span className="eyebrow">
                    {profile.nft.mode === "demo"
                      ? "MONAD TESTNET · DEMO COLLECTION"
                      : "ORIGINAL CHOG · EVOLUTION COMPANION"}
                  </span>
                  <Icon name="spark" size={27} />
                </div>
                <h2 id="profile-name">{profile.displayName}</h2>
                <span className="stage-pill">{titleCase(profile.stage)}</span>
                <p className="profile-tagline">
                  A little more you with every chapter.
                </p>
                <dl className="profile-stats">
                  <div>
                    <dt>Level</dt>
                    <dd>{profile.level}</dd>
                  </div>
                  <div>
                    <dt>Total XP</dt>
                    <dd>{profile.xp.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Accepted quests</dt>
                    <dd>{accepted.length}</dd>
                  </div>
                </dl>
                <Progress profile={profile} />
                <div className="button-row">
                  <Link className="button button-primary" href="/upgrade">
                    Check for an evolution <Icon name="spark" size={18} />
                  </Link>
                  <Link className="text-link" href={`/passport/${profile.id}`}>
                    View passport <Icon name="up-right" size={16} />
                  </Link>
                </div>
              </div>
            </section>
            <section className="profile-details">
              <div>
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">THE DETAILS MAKE THE CHOG</span>
                    <h2>Your signature traits.</h2>
                  </div>
                  <Icon name="chog" size={32} />
                </div>
                <ProfileTraits profile={profile} />
              </div>
              <aside className="profile-next">
                <span className="eyebrow">A LITTLE ADVENTURE?</span>
                <h3>
                  Make the next
                  <br />
                  chapter a good one.
                </h3>
                <p>
                  There’s more of the ecosystem to explore, and more of your
                  Chog to discover.
                </p>
                <Link className="text-link" href="/quests">
                  Find a quest <Icon name="arrow" size={18} />
                </Link>
              </aside>
            </section>
            <TraitInventory
              key={`${address.toLowerCase()}:${profile.id}`}
              profile={profile}
            />
            <XProfileLink />
            <section className="profile-recent">
              <div className="section-heading">
                <div>
                  <span className="eyebrow">LITTLE STEPS, BIG STORY</span>
                  <h2>Recently, in your world.</h2>
                </div>
                <Link className="text-link" href="/activity">
                  All activity <Icon name="arrow" size={18} />
                </Link>
              </div>
              {claimError && (
                <Notice
                  tone="error"
                  action={
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void refreshData()}
                    >
                      Retry
                    </button>
                  }
                >
                  {claimError}
                </Notice>
              )}
              {profileClaims.length ? (
                <ClaimList claims={profileClaims.slice(0, 3)} compact />
              ) : (
                <div className="quiet-empty">
                  <Icon name="clock" size={26} />
                  <p>
                    No quest activity yet. Your first contribution is a good
                    place to start.
                  </p>
                  <Link className="text-link" href="/quests">
                    Explore quests <Icon name="up-right" size={16} />
                  </Link>
                </div>
              )}
            </section>
          </>
        )}
      </ProfileGate>
      {signedIn && (
        <section className="collection-tools" aria-label="Collection tools">
          <div>
            <span className="eyebrow">YOUR WALLET</span>
            <p>
              {address.slice(0, 6)}…{address.slice(-4)}
              <button
                className="text-button"
                type="button"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </p>
          </div>
          <DiscoverButton />
        </section>
      )}
    </main>
  );
}
