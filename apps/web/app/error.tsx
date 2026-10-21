"use client";

import { Icon } from "../components/icons";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="product-page section-width" id="main-content">
      <div className="empty-state">
        <span className="empty-icon">
          <Icon name="chog" size={38} />
        </span>
        <h1>A little unexpected detour.</h1>
        <p>
          Chog couldn’t load this part of the story. Your progress is saved.
          Give it another try.
        </p>
        <div className="button-row">
          <button
            className="button button-primary"
            type="button"
            onClick={reset}
          >
            Try again <Icon name="refresh" size={18} />
          </button>
          <a className="button button-secondary" href="/">
            Back to the story
          </a>
        </div>
      </div>
    </main>
  );
}
