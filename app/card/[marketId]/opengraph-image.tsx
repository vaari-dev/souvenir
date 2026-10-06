import { ImageResponse } from "next/og";
import { cardOf } from "@/lib/data";
import { piesText } from "@/lib/pies";

export const alt = "A prediction from a friend trip on Souvenir";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// System fonts only: a chat gives the card little time to render.
export default async function Image({ params }: { params: Promise<{ marketId: string }> }) {
  const { marketId } = await params;
  const card = await cardOf(marketId);
  const question = card?.question ?? "Souvenir";
  const settled = card && (card.verdict === "yes" || card.verdict === "no");
  const verdict = !card ? "" : card.verdict === "refunded" ? "VOIDED" : card.verdict.toUpperCase();
  const names = (list: { name: string; profitC: number }[]) =>
    list
      .slice(0, 4)
      .map((x) => `${x.name} ${piesText(x.profitC, { sign: true })}`)
      .join("   ");

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#143024",
        color: "#f1eee4",
        padding: 64,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", fontSize: 28, color: "#e8c46a", letterSpacing: 2 }}>
        {card ? card.tripName.toUpperCase() : "SOUVENIR"}
      </div>
      <div
        style={{
          display: "flex",
          fontSize: question.length > 80 ? 52 : 64,
          fontWeight: 800,
          lineHeight: 1.1,
        }}
      >
        {question}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {verdict && (
          <div
            style={{
              display: "flex",
              fontSize: 40,
              fontWeight: 800,
              color:
                card?.verdict === "yes"
                  ? "#9db9e8"
                  : card?.verdict === "no"
                    ? "#eda06d"
                    : "#e8c46a",
            }}
          >
            {settled ? `RESOLVED ${verdict}` : verdict}
          </div>
        )}
        {card && settled && card.winners.length > 0 && (
          <div style={{ display: "flex", fontSize: 26, color: "#f1eee4" }}>
            Called it: {names(card.winners)}
          </div>
        )}
        {card && settled && card.losers.length > 0 && (
          <div style={{ display: "flex", fontSize: 26, color: "rgba(241,238,228,0.7)" }}>
            Paid for it: {names(card.losers)}
          </div>
        )}
        <div style={{ display: "flex", fontSize: 22, color: "rgba(241,238,228,0.55)" }}>
          Souvenir · the app for the trip that actually happens · stamps are never money
        </div>
      </div>
    </div>,
    { ...size },
  );
}
