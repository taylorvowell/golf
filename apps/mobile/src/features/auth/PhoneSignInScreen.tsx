import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";

import { Button, DisplayText, Eyebrow, Input, SwingLoader } from "../../design/system";
import { FONT_BODY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";
import {
  OTP_LENGTH,
  OtpRateLimited,
  PhoneNumberInvalid,
  RESEND_COOLDOWN_SECONDS,
  formatE164ForDisplay,
  formatPhoneAsTyped,
  sendPhoneOtp,
  toE164,
  verifyPhoneOtp,
} from "./phone";

/**
 * Phone sign-in: number, then code. Two steps on one screen, not two routes.
 *
 * There is no navigator above the signed-out state — `AuthGate` renders a screen directly — so
 * the step lives in local state. That happens to be the right shape anyway: going "back" from the
 * code step must return to a number field that still holds the number, and a route pop that
 * remounted an empty field would be a small betrayal after someone already typed it once.
 *
 * §41: full-width 48dp controls, number pads, and no step that needs two hands. This is used
 * outdoors on a range.
 */
export function PhoneSignInScreen({ onCancel }: { onCancel: () => void }) {
  const [step, setStep] = useState<"number" | "code">("number");
  const [phone, setPhone] = useState("");
  const [e164, setE164] = useState<string | null>(null);
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

  async function send(number: string, resend: boolean) {
    setBusy(true);
    setError(null);
    try {
      const normalized = toE164(number);
      await sendPhoneOtp(normalized);
      setE164(normalized);
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
        err instanceof PhoneNumberInvalid || err instanceof OtpRateLimited || err instanceof Error
          ? err.message
          : "Could not send the code.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function verify(entered: string) {
    if (!e164) return;
    setBusy(true);
    setError(null);
    try {
      await verifyPhoneOtp(e164, entered);
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
        <DisplayText>{step === "number" ? "Your number" : "Enter the code"}</DisplayText>
        <Text style={styles.lede}>
          {step === "number"
            ? "We'll text you a code. No password to choose, and nothing to remember."
            : `Sent to ${formatE164ForDisplay(e164 ?? "")}. It expires in a few minutes.`}
        </Text>
      </View>

      {step === "number" ? (
        <View style={styles.actions}>
          <Input
            label="Phone number"
            value={phone}
            onChangeText={(v) => {
              setPhone(formatPhoneAsTyped(v));
              if (error) setError(null);
            }}
            placeholder="(555) 123-4567"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            autoFocus
            editable={!busy}
            onSubmitEditing={() => void send(phone, false)}
          />
          <Button
            label={busy ? "Sending…" : "Send code"}
            onPress={() => void send(phone, false)}
            disabled={busy || phone.trim().length === 0}
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
            // Android reads the code straight out of the SMS; iOS offers it above the keyboard.
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={OTP_LENGTH}
            autoFocus
            editable={!busy}
            style={styles.codeField}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || cooldown > 0}
            onPress={() => void send(phone, true)}
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
        label={step === "number" ? "Other sign-in options" : "Use a different number"}
        variant="ghost"
        onPress={() => {
          setError(null);
          if (step === "code") {
            setStep("number");
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
