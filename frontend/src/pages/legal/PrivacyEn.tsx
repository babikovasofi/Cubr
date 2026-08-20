// English privacy notice (Stage 6). The Russian source is PrivacyRu.tsx.
//
// Same rule as the rules page: long prose is translated whole, and BOTH files
// change together. In particular, the day proof frames start being uploaded,
// this page and its Russian twin must be updated in the same commit — before
// the upload ships, not after.

import { Link } from "react-router-dom";
import { DocPage, DocSection, DocList } from "../../components/DocPage";

// TODO(stage 6, deploy): replace with the project's real mailbox on its own domain.
const CONTACT_EMAIL = "privacy@cubr-game.ru";

export default function PrivacyEn() {
  return (
    <DocPage
      title="Data and privacy"
      updated="27 July 2026"
      lead="What happens to the video, what the server stores, what other players see, and how to delete it."
    >
      <DocSection title="Camera video">
        <DocList
          items={[
            <>
              <span className="font-bold text-ink">The video never leaves your computer.</span>{" "}
              Frames are analysed inside the browser: colour and hand recognition run locally.
            </>,
            <>No recording of the solve is made — neither on the server nor in the browser.</>,
            <>
              Your opponent in a duel sees only status and time, never any image from your camera.
            </>,
            <>
              You grant camera access to the browser and can revoke it at any moment in its settings
              for this site.
            </>,
            <>
              For the future: server-side honesty verification will require sending individual
              snapshot frames. It is not enabled yet, and this page will be updated before it is
              switched on, not after.
            </>,
          ]}
        />
      </DocSection>

      <DocSection title="What the server stores">
        <DocList
          items={[
            <>
              Email, a password hash (the password itself is never stored), nickname, and whether
              the email is confirmed.
            </>,
            <>For Google sign-in — the Google account identifier and the email from it.</>,
            <>Solves: time, status, scramble, date, and which cube was used.</>,
            <>
              Cube profiles — numeric colour references for your cubes. That is a set of numbers,
              not photographs.
            </>,
            <>
              Weekly-challenge and daily-scramble attempts, duel rooms and their results, badges.
            </>,
            <>A public handle — only if you set one yourself in the profile.</>,
          ]}
        />
      </DocSection>

      <DocSection title="What other players see">
        <DocList
          items={[
            <>
              On the weekly-challenge and daily-scramble boards — your public handle or «Anonymous»,
              plus your time. Email and nickname are{" "}
              <span className="font-bold text-ink">never</span> shown.
            </>,
            <>
              The public handle is set by hand and empty by default — by default you are
              «Anonymous».
            </>,
            <>In a duel the opponent sees status, time and outcome — and nothing else.</>,
          ]}
        />
      </DocSection>

      <DocSection title="Cookies and local storage">
        <DocList
          items={[
            <>
              The <span className="font-mono text-small text-ink">cubr_auth</span> cookie is your
              login session. It is httpOnly and SameSite=Lax: page JavaScript cannot read it and it
              is not sent to third-party sites. Logging in is impossible without it.
            </>,
            <>
              Browser localStorage: colour theme, time display format, scramble display mode,
              selected cube, countdown mute, the current duel session key, and whether onboarding
              was completed.
            </>,
            <>
              There is no third-party analytics, no advertising pixels and no trackers on this site.
              Data is not sold and not handed to anyone beyond the services listed below.
            </>,
          ]}
        />
      </DocSection>

      <DocSection title="External services">
        <DocList
          items={[
            <>
              The email provider that delivers confirmation and password-reset letters; it receives
              the recipient address and the letter's text.
            </>,
            <>Google — only if you chose Google sign-in yourself.</>,
            <>
              The site and database hosting — that is where everything listed above physically
              lives.
            </>,
          ]}
        />
      </DocSection>

      <DocSection title="Change or delete">
        <DocList
          items={[
            <>
              Nickname, public handle, time format and cube profiles are changed in your profile.
            </>,
            <>
              Deleting the account and everything tied to it — by request at{" "}
              <a href={`mailto:${CONTACT_EMAIL}`} className="font-bold text-primary">
                {CONTACT_EMAIL}
              </a>
              . There is no self-service delete button yet; requests are handled by hand.
            </>,
            <>The same address for questions about what is stored about you.</>,
          ]}
        />
      </DocSection>

      <DocSection title="Next">
        <p className="font-sans text-body text-muted">
          How a solve runs and what counts is on the{" "}
          <Link to="/rules" className="font-bold text-primary">
            «Rules»
          </Link>{" "}
          page.
        </p>
      </DocSection>
    </DocPage>
  );
}
