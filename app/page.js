"use client";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <div className="page">
      <div className="card">
        <h1 className="title">🎤 KARAOKE REMOTE</h1>

        <p className="subtitle">Choose your role:</p>

        <div className="buttons">
          <button
            className="btn admin"
            onClick={() => router.push("/tv")}
          >
            👑 ADMIN
          </button>

          <button
            className="btn singer"
            onClick={() => router.push("/controller")}
          >
            🎤 SINGER
          </button>
        </div>
      </div>

      <style jsx>{`
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
        }

        .page {
          min-height: 100vh;
          background: linear-gradient(180deg, #6f7bd9, #7b63c7);
          display: flex;
          justify-content: center;
          padding-top: 90px;
        }

        .card {
          width: 90%;
          max-width: 420px;
          background: radial-gradient(circle at top, #1b224a, #0b0f2a);
          border-radius: 26px;
          padding: 28px 22px 34px;
          text-align: center;
          box-shadow:
            0 0 0 4px rgba(140, 160, 255, 0.6),
            0 20px 40px rgba(0, 0, 0, 0.55);
        }

        .title {
          margin: 0 0 18px;
          font-size: 28px;
          font-weight: 800;
          color: #ffffff;
          letter-spacing: 1px;
        }

        .subtitle {
          margin: 0 0 26px;
          font-size: 18px;
          color: #d6d9ff;
        }

        .buttons {
          display: flex;
          gap: 14px;
        }

        .btn {
          flex: 1;
          padding: 16px 12px;
          font-size: 18px;
          font-weight: 800;
          border-radius: 14px;
          border: none;
          cursor: pointer;
          color: #ffffff;
          letter-spacing: 1px;
          transition: transform 0.15s ease, box-shadow 0.15s ease;
        }

        .btn:active {
          transform: scale(0.97);
        }

        .admin {
          background: linear-gradient(180deg, #ff8a00, #ff5c00);
          box-shadow: 0 6px 0 #c94700;
        }

        .singer {
          background: linear-gradient(180deg, #00e5ff, #00bcd4);
          box-shadow: 0 6px 0 #008fa1;
        }

        @media (max-width: 380px) {
          .title {
            font-size: 24px;
          }

          .btn {
            font-size: 16px;
          }
        }
      `}</style>
    </div>
  );
}
