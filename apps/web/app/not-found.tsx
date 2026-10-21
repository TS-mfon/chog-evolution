import Link from "next/link";
import { Icon } from "../components/icons";

export default function NotFound() {
  return (
    <main className="product-page section-width" id="main-content">
      <div className="empty-state">
        <span className="empty-icon">
          <Icon name="chog" size={38} />
        </span>
        <div className="eyebrow">A LITTLE OFF THE TRAIL</div>
        <h1>This Chog wandered off.</h1>
        <p>
          We couldn’t find that page. There’s plenty more of the Chog world to
          explore.
        </p>
        <div className="button-row">
          <Link className="button button-primary" href="/">
            Back to the story <Icon name="arrow" size={18} />
          </Link>
          <Link className="button button-secondary" href="/profile">
            Find my Chog
          </Link>
        </div>
      </div>
    </main>
  );
}
