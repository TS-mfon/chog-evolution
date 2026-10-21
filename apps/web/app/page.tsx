import Link from "next/link";
import { Icon } from "../components/icons";
import { Reveal, StoryMotion } from "../components/motion";

const stages = [
  { name: "Hatchling", xp: "0", note: "Hello, world." },
  { name: "Curious", xp: "50", note: "What’s over there?" },
  { name: "Explorer", xp: "150", note: "Finding your people." },
  { name: "Veteran", xp: "350", note: "A story worth telling." },
  { name: "Legend", xp: "700", note: "Unmistakably you." },
];

export default function Home() {
  return (
    <main id="main-content" className="story-page">
      <StoryMotion />
      <section className="story-hero" aria-labelledby="hero-heading">
        <div className="hero-topline intro">
          <span className="eyebrow">
            <span className="tiny-dot" />A small creature. An unfinished story.
          </span>
          <span className="hero-edition">
            MONAD’S CURIOUS SIDE <Icon name="spark" size={15} />
          </span>
        </div>
        <h1
          id="hero-heading"
          className="hero-wordmark intro"
          aria-label="Chog. Born different. Built to evolve."
        >
          CHOG<span className="wordmark-period">.</span>
        </h1>
        <div className="hero-creature intro">
          <img
            src="/brand/chog-hero.webp"
            alt="Meet Chog: purple quills, big eyes, and an attitude all its own"
            width={1000}
            height={1000}
            fetchPriority="high"
          />
        </div>
        <div className="hero-copy intro">
          <h2>
            Born different.
            <br />
            Built to evolve.
          </h2>
          <p>
            A collectible with a little attitude.
            <br />A story that grows with everything you do.
          </p>
          <Link className="button button-primary button-large" href="/mint">
            Meet your Chog <Icon name="up-right" />
          </Link>
        </div>
        <div className="hero-sticker intro">
          <Icon name="spark" size={24} />
          <span>
            GOOD THINGS
            <br />
            GET WEIRDER.
          </span>
        </div>
        <a className="hero-scroll" href="#origin">
          <span>There’s more to this little face</span>
          <span className="scroll-orbit">
            <Icon name="arrow" size={19} />
          </span>
        </a>
        <span className="hero-side-note">
          NOT FINISHED. JUST GETTING STARTED.
        </span>
      </section>
      <div className="story-ribbon" aria-hidden="true">
        <div>
          <span>STAY CURIOUS</span>
          <Icon name="spark" size={28} />
          <span>MAKE YOUR MARK</span>
          <Icon name="spark" size={28} />
          <span>EVOLVE TOGETHER</span>
          <Icon name="spark" size={28} />
          <span>STAY CHOG</span>
          <Icon name="spark" size={28} />
        </div>
      </div>
      <section
        className="origin-section section-width"
        id="origin"
        aria-labelledby="origin-heading"
      >
        <Reveal className="origin-art">
          <div className="art-orbit" aria-hidden="true" />
          <figure className="origin-portrait">
            <img
              src="/brand/chog-little.webp"
              alt="A tiny purple Chog with a very big sense of wonder"
              width={408}
              height={384}
              loading="lazy"
            />
            <figcaption>BIG IDEAS. TINY FEET.</figcaption>
          </figure>
          <figure className="origin-snapshot">
            <img
              src="/brand/chog-early.webp"
              alt="An earlier, rounder Chog character"
              width={356}
              height={361}
              loading="lazy"
            />
            <figcaption>every story starts somewhere ↗</figcaption>
          </figure>
          <span className="origin-doodle" aria-hidden="true">
            *
          </span>
        </Reveal>
        <Reveal className="origin-copy" delay={120}>
          <div className="eyebrow">
            <span>01 / THE BEGINNING</span>
            <span className="line" />
          </div>
          <h2 id="origin-heading">
            A little weird.
            <br />A lot of <em>you.</em>
          </h2>
          <p className="lead">
            Some creatures collect dust.
            <br />
            Chogs collect stories.
          </p>
          <p>
            It starts with a face you can’t quite forget. A curious little
            outsider with purple quills and somewhere to be. Then you show up,
            and the story gets interesting.
          </p>
          <p>
            The things you build. The communities you join. The moments you
            share. Your Chog carries a little of it all.
          </p>
          <Link className="text-link" href="/evolution">
            See what it can become <Icon name="up-right" />
          </Link>
        </Reveal>
      </section>
      <section
        className="evolution-section"
        aria-labelledby="evolution-heading"
      >
        <div className="section-width">
          <Reveal className="evolution-intro">
            <div>
              <div className="eyebrow">02 / NOTHING STAYS LITTLE FOREVER</div>
              <h2 id="evolution-heading">
                You grow.
                <br />
                They change.
              </h2>
            </div>
            <div className="evolution-intro-copy">
              <Icon name="spark" size={46} />
              <p>
                Go on quests. Contribute to the ecosystem. Earn XP for
                contributions that pass review. Every chapter brings your Chog
                closer to its next evolution.
              </p>
              <span className="caption">
                Five stages. A story only you can write.
              </span>
            </div>
          </Reveal>
          <div
            className="stage-scroll"
            role="region"
            aria-label="The five Chog evolution stages"
            tabIndex={0}
          >
            <ol className="stage-trail">
              {stages.map((stage, index) => (
                <li key={stage.name}>
                  <Reveal delay={index * 70}>
                    <span className={`stage-orbit stage-orbit-${index}`}>
                      <Icon name="chog" size={38 + index * 7} />
                      {index === 4 && (
                        <Icon name="spark" className="stage-star" size={21} />
                      )}
                    </span>
                    <span className="stage-index">0{index + 1}</span>
                    <h3>{stage.name}</h3>
                    <span className="stage-xp">{stage.xp} XP</span>
                    <p>{stage.note}</p>
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
          <div className="evolution-footnote">
            <span>
              Your evolution is earned through accepted contributions.
            </span>
            <Link className="text-link" href="/quests">
              Find your first quest <Icon name="arrow" size={18} />
            </Link>
          </div>
        </div>
      </section>
      <section
        className="world-section section-width"
        aria-labelledby="world-heading"
      >
        <Reveal className="world-heading">
          <div className="eyebrow">03 / MORE THAN A PROFILE PICTURE</div>
          <h2 id="world-heading">
            Small creature.
            <br />
            <em>Whole new world.</em>
          </h2>
          <p>
            You don’t have to be the loudest in the room.
            <br />
            Just show up. Explore. Make something yours.
          </p>
        </Reveal>
        <Reveal>
          <figure className="world-art">
            <img
              src="/brand/chog-world.webp"
              alt="A Chog discovering its power, surrounded by purple friends in the Chog world"
              width={1800}
              height={1440}
              loading="lazy"
            />
            <figcaption>
              <span className="world-art-label">
                <span className="tiny-dot" />
                THE CHOG WORLD
              </span>
              <span>Better with a little company.</span>
            </figcaption>
          </figure>
        </Reveal>
        <div className="story-actions">
          <Reveal>
            <span className="story-action-number">01</span>
            <div>
              <h3>Start with a Chog.</h3>
              <p>
                Mint your own demo NFT on Monad Testnet. We’ll handle the setup
                so you can get to the good part.
              </p>
              <Link className="text-link" href="/mint">
                Find your little weirdo <Icon name="up-right" size={17} />
              </Link>
            </div>
          </Reveal>
          <Reveal delay={90}>
            <span className="story-action-number">02</span>
            <div>
              <h3>Give it a story.</h3>
              <p>
                Take on a quest, share something you made, or discover what your
                Monad activity has already earned.
              </p>
              <Link className="text-link" href="/upgrade">
                Explore your next chapter <Icon name="up-right" size={17} />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
      <section className="closing-section" aria-labelledby="closing-heading">
        <div className="section-width">
          <Reveal className="closing-inner">
            <div className="closing-copy">
              <div className="eyebrow">THIS IS WHERE YOU COME IN.</div>
              <h2 id="closing-heading">
                Your next chapter
                <br />
                has quills.
              </h2>
              <p>We’ve got a good feeling about you two.</p>
              <Link className="button button-dark button-large" href="/mint">
                Start your story <Icon name="up-right" />
              </Link>
            </div>
            <div className="closing-art">
              <img
                src="/brand/chog-expression.webp"
                alt="A Chog with happy tears, ready to meet you"
                width={900}
                height={900}
                loading="lazy"
              />
              <span className="closing-note">
                already emotionally invested.
              </span>
            </div>
          </Reveal>
        </div>
      </section>
    </main>
  );
}
