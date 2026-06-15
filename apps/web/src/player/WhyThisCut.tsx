// "Why this cut": the EU AI Act Article 50 disclosure (enforceable 2 Aug 2026) and the honest delivery of
// the homepage promise. It tells the viewer, in plain language, that the story re-cut for them and WHY
// (the named features that drove the selection), and carries a machine-readable disclosure for automated
// readers. The cut is selected from pre-rendered variants - nothing is generated uniquely - so the claim
// is true and affordable. No em dashes.

export interface Adaptation {
  isControl: boolean;
  language: string;
  intensity?: number;
  captions: boolean;
  audioDescription: boolean;
  sign: boolean;
  policyVersion?: string;
  decisionId?: string;
}

export function WhyThisCut({
  adaptation,
  open,
  onClose,
}: {
  adaptation: Adaptation;
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const pace =
    (adaptation.intensity ?? 3) <= 2
      ? "a calmer pace"
      : (adaptation.intensity ?? 3) >= 5
        ? "a more intense pace"
        : "a balanced pace";
  const tracks =
    [
      adaptation.captions && "captions",
      adaptation.audioDescription && "audio description",
      adaptation.sign && "sign language",
    ]
      .filter(Boolean)
      .join(", ") || "no extra tracks";

  // Machine-readable disclosure (Article 50): a JSON record automated readers can parse off the DOM.
  const machine = JSON.stringify({
    adapted: true,
    method: "cached_variant_selection",
    generated_uniquely: false,
    is_control: adaptation.isControl,
    language: adaptation.language,
    intensity: adaptation.intensity ?? null,
    accessibility: {
      captions: adaptation.captions,
      audio_description: adaptation.audioDescription,
      sign: adaptation.sign,
    },
    policy_version: adaptation.policyVersion ?? null,
    decision_id: adaptation.decisionId ?? null,
  });

  return (
    <div
      className={`sheet${open ? " up" : ""}`}
      data-testid="why-this-cut"
      data-adaptation={machine}
      role="dialog"
      aria-label="Why this cut"
      aria-hidden={!open}
    >
      <div className="ey" style={{ marginBottom: 10 }}>
        Why this cut
      </div>
      <h3>This story re-cut itself for you</h3>
      <p className="muted" style={{ lineHeight: 1.6 }}>
        {adaptation.isControl
          ? "You are watching the standard director's cut. You are in a small measurement group that always sees the same cut, which lets us prove the adaptation actually helps."
          : `You are watching a version chosen for you: your language (${adaptation.language.toUpperCase()}), ${pace}, with ${tracks} on.`}
      </p>
      <p className="muted" style={{ lineHeight: 1.6, marginTop: 10 }}>
        The cut is selected from pre-rendered variants of one production. Nothing here is generated uniquely
        for you. Adapted content is disclosed under the EU AI Act.
      </p>
      <p className="muted" style={{ fontSize: 11, marginTop: 10 }} data-testid="why-policy">
        Policy {adaptation.policyVersion ?? "n/a"}
        {adaptation.decisionId ? ` · decision ${adaptation.decisionId.slice(0, 8)}` : ""}
      </p>
      <button type="button" className="paybtn ghost" onClick={onClose} data-testid="why-close">
        Got it
      </button>
    </div>
  );
}
