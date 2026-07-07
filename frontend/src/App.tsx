import { Routes, Route, Link } from "react-router-dom";
import HomePage from "./pages/HomePage";
import SoloPage from "./pages/SoloPage";

function Header() {
  return (
    <header className="h-12 border-b border-line bg-surface">
      <div className="mx-auto flex h-full max-w-content items-center px-4">
        <Link to="/" className="font-sans text-h3 font-black text-ink no-underline">
          Cubr
        </Link>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      <Header />
      <main className="mx-auto max-w-content px-4 py-7">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/solo" element={<SoloPage />} />
        </Routes>
      </main>
    </div>
  );
}
