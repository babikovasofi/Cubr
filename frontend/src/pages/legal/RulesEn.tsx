// English rules (Stage 6). The Russian source is RulesRu.tsx.
//
// Long prose is translated as a whole page, not phrase by phrase: with the
// per-string dictionary a single paragraph would end up half-Russian the moment
// one sentence is missing. Both files must be edited together — in particular
// when the honesty brick lands and "the server does not re-check video" stops
// being true.

import { Link } from "react-router-dom";
import { DocPage, DocSection, DocList } from "../../components/DocPage";

export default function RulesEn() {
  return (
    <DocPage
      title="Rules"
      updated="27 July 2026"
      lead="How a solve runs, how the time is measured, what a DNF is, and what «honest» means today."
    >
      <DocSection title="The solve ritual">
        <p className="font-sans text-body text-muted">
          The order of the steps is strict and identical in every mode — it is what replaces a
          judge.
        </p>
        <ol className="flex list-decimal flex-col gap-2 pl-5">
          <li className="font-sans text-body text-muted">
            <span className="font-bold text-ink">Show the solved cube.</span> The browser learns
            your cube's colours under the current light. This is always the first step: until the
            cube has been shown, no scramble is issued and the timer cannot be armed.
          </li>
          <li className="font-sans text-body text-muted">
            <span className="font-bold text-ink">The server issues the scramble.</span> It is shown
            as step-by-step pictures or as notation — switchable on the solving screen.
          </li>
          <li className="font-sans text-body text-muted">
            <span className="font-bold text-ink">Scramble check.</span> Scramble the cube, then show
            it; the state read from the camera is compared with the expected one. No match — the
            check repeats and the clock does not run.
          </li>
          <li className="font-sans text-body text-muted">
            <span className="font-bold text-ink">Both hands on the table — ready.</span> Lift your
            hands and the clock runs. In a duel the start moment is shared and set by the server.
          </li>
          <li className="font-sans text-body text-muted">
            <span className="font-bold text-ink">Hands on the table — stop.</span> Then show the
            cube to the camera: the solve is confirmed and the time is recorded.
          </li>
        </ol>
      </DocSection>

      <DocSection title="How the time is measured">
        <DocList
          items={[
            <>
              Time is measured in camera frames: one step is one frame, usually about 33 ms at 30
              frames per second. This is not a mechanical StackMat — the precision is below
              competition grade.
            </>,
            <>
              The start is the moment your hands left the table. The stop is the moment both hands
              came back.
            </>,
            <>
              In a duel the countdown and the start moment come from the server to both players at
              once, so network delay gives nobody a head start.
            </>,
            <>The display format (seconds or mm:ss) is switched in your profile.</>,
          ]}
        />
      </DocSection>

      <DocSection title="DNF — when an attempt does not count">
        <DocList
          items={[
            <>Your hands or the cube left the frame during the solve — the attempt is cut short.</>,
            <>
              A weekly-challenge or daily-scramble attempt that is not submitted within 10 minutes
              of its start closes automatically as a DNF.
            </>,
          ]}
        />
        <p className="font-sans text-body text-muted">
          A separate case is a solve without the camera check (the verification step was skipped),
          or with a quick colour adjustment instead of a full calibration: the time is saved but
          marked as unconfirmed. A DNF stays in your history; the personal best counts only solves
          that were counted.
        </p>
      </DocSection>

      <DocSection title="One attempt per shared scramble">
        <DocList
          items={[
            <>
              The weekly challenge is one scramble per week, the daily scramble is one per day, and
              everyone gets a single attempt.
            </>,
            <>
              The scramble is revealed only after you explicitly confirm the start. Reloading the
              page returns the same attempt and the same scramble — a new one is never issued.
            </>,
            <>
              Duels are not written into your personal solve history: the result there is a win, a
              loss or a draw.
            </>,
          ]}
        />
      </DocSection>

      <DocSection title="What «honest» means today">
        <DocList
          items={[
            <>
              <span className="font-bold text-ink">The server generates the scramble</span> and
              signs it with a one-time token: a saved solve is tied to the scramble that was issued.
            </>,
            <>
              <span className="font-bold text-ink">The browser reports the time.</span> There is no
              server-side re-check of the video yet — frames never leave your machine.
            </>,
            <>
              <span className="font-bold text-ink">
                That is why there are no places or ratings.
              </span>{" "}
              Participant lists carry no positions, and badges and records are personal statistics
              rather than a ranked table. Ratings arrive together with server-side verification.
            </>,
          ]}
        />
      </DocSection>

      <DocSection title="Cube, camera and light">
        <DocList
          items={[
            <>
              You need a computer with a camera. Mobile browsers are not supported: the ritual needs
              two free hands and a camera that stays put.
            </>,
            <>
              Even room light. Coloured lighting, strong backlight and deep shadow break colour
              recognition.
            </>,
            <>
              A cube is registered as a colour profile — up to 5 cubes per account. Badly faded
              stickers, or stickers in unusual shades, may read inconsistently.
            </>,
          ]}
        />
      </DocSection>

      <DocSection title="Next">
        <p className="font-sans text-body text-muted">
          What we store and what other players can see is on the{" "}
          <Link to="/privacy" className="font-bold text-primary">
            «Data and privacy»
          </Link>{" "}
          page.
        </p>
      </DocSection>
    </DocPage>
  );
}
