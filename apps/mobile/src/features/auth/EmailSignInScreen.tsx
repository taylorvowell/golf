import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Button, DisplayText, Eyebrow, Input, SwingLoader } from "../../design/system";
import { FONT_BODY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";
import { EmailInvalid, normalizeEmail, sendEmailOtp, verifyEmailOtp } from "./email";
import { OTP_LENGTH, OtpRateLimited, RESEND_COOLDOWN_SECONDS } from "./phone";

/**
 * Email sign-in: address, then code. The structural twin of `PhoneSignInScreen`, and deliberately
 * so — the two flows must feel like one product, and every divergence between them is a place for
 * a fix to land on one and not the other. Where this file differs it says why at the site.
 *
 * Two steps on one screen, not two routes, for the same reason as phone: going "back" from the
 * code step must return to a field that still holds the address.
 */
export function EmailSignInScreen({ onCancel }: { onCancel: () => void }) {
  const [step, setStep] = useState<"address" | "code">("address");
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const t = useTheme();
  const styles = useStyles();
  const codeRef = useRef<TextInput>(null);

  // One interval for the resend countdown, torn down when it reaches zero or the screen goes.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  async function send(raw: string, resend: boolean) {
    setBusy(true);
    setError(null);
    try {
      const normalized = normalizeEmail(raw);
      await sendEmailOtp(normalized);
      setSentTo(normalized);
      setStep("code");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (resend) setCode("");
      // The keyboard should already be waiting on the code field — the golfer is looking at their
      // notification shade, and coming back to a screen that needs another tap to type is friction
      // at exactly the moment the code is about to expire.
      setTimeout(() => codeRef.current?.focus(), 50);
    } catch (err) {
      if (err instanceof OtpRateLimited) setCooldown(err.retryAfterSeconds);
      setError(
        err instanceof EmailInvalid || err instanceof Error
          ? err.message
          : "Could not send the code.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(entered: string) {
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    try {
      await verifyEmailOtp(sentTo, entered);
      // No navigation. `onAuthStateChange` fires and the gate swaps this screen out — one source
      // of truth for "am I signed in", not two that can disagree.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check the code.");
      setCode("");
    } finally {
      setBusy(false);
    }
  }

  function onCodeChange(next: string) {
    const digits = next.replace(/\D/g, "").slice(0, OTP_LENGTH);
    setCode(digits);
    if (error) setError(null);
    // Submit on the last digit. Making someone reach for a button after typing a code they were
    // just handed is a tap that exists only because the form has one.
    if (digits.length === OTP_LENGTH && !busy) void verify(digits);
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Eyebrow>SwingSage</Eyebrow>
        <DisplayText>{step === "address" ? "Your email" : "Enter the code"}</DisplayText>
        <Text style={styles.lede}>
          {step === "address"
            ? "We'll email you a code. No password to choose, and nothing to remember."
            : `Sent to ${sentTo ?? ""}. It expires in one hour.`}
        </Text>
      </View>

      {step === "address" ? (
        <View style={styles.actions}>
          <Input
            label="Email address"
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              if (error) setError(null);
            }}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            editable={!busy}
            onSubmitEditing={() => void send(email, false)}
          />
          <Button
            label={busy ? "Sending…" : "Send code"}
            onPress={() => void send(email, false)}
            disabled={busy || email.trim().length === 0}
            style={styles.wide}
          />
        </View>
      ) : (
        <View style={styles.actions}>
          <Input
            ref={codeRef}
            label={`${OTP_LENGTH}-digit code`}
            value={code}
            onChangeText={onCodeChange}
            placeholder="000000"
            keyboardType="number-pad"
            // The OS offers a mailed code above the keyboard the same way it offers an SMS one.
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={OTP_LENGTH}
            autoFocus
            editable={!busy}
            style={styles.codeField}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || cooldown > 0}
            onPress={() => void send(sentTo ?? email, true)}
            style={({ pressed }) => [styles.resend, pressed && styles.resendPressed]}
          >
            <Text style={cooldown > 0 ? styles.resendWaiting : styles.resendReady}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Send a new code"}
            </Text>
          </Pressable>
        </View>
      )}

      {busy ? <SwingLoader size={30} /> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Button
        label={step === "address" ? "Other sign-in options" : "Use a different email"}
        variant="ghost"
        onPress={() => {
          setError(null);
          if (step === "code") {
            setStep("address");
            setCode("");
          } else {
            onCancel();
          }
        }}
        disabled={busy}
        style={styles.wide}
      />
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  root: { flex: 1, backgroundColor: t.bg, padding: 24, justifyContent: "center", gap: 22 },
  header: { gap: 8 },
  lede: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 20 },
  actions: { gap: 14, alignItems: "stretch" },
  wide: { alignSelf: "stretch", minHeight: 48 },
  // Wide tracking so six digits read as six separable characters, not a number.
  codeField: { fontSize: 22, letterSpacing: 8, textAlign: "center", minHeight: 56 },
  resend: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 12 },
  // A text link still has to answer the tap — opacity is the only fill-free option here.
  resendPressed: { opacity: 0.6 },
  resendReady: { color: t.cobalt, fontFamily: FONT_BODY.semiBold, fontSize: 12.5 },
  resendWaiting: { color: t.muted2, fontFamily: FONT_BODY.regular, fontSize: 12.5 },
  error: { color: t.bad, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 19 },
}));
