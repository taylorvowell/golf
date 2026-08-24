import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

import { Button, Input } from "../../design/system";
import { FONT_BODY } from "../../design/system/typography";
import { themedStyles, useTheme } from "../../theme";
import {
  EmailInvalid,
  attachEmail,
  normalizeEmail,
  verifyAttachedEmail,
} from "../auth/email";
import { OTP_LENGTH, OtpRateLimited, RESEND_COOLDOWN_SECONDS } from "../auth/phone";

/**
 * Onboarding's "add your email" question, shown only to an account that has none — one that
 * signed up by phone, or through Apple's private relay once that lands.
 *
 * This is the step that keeps one golfer ONE account. A phone-only identity carries no address,
 * so the same person signing in by email or Google on another surface would mint a second, empty
 * account. Attaching here goes through `updateUser`, which is what makes either identifier open
 * the same account afterwards.
 *
 * NOT skippable, unlike most onboarding questions — `users.email` is NOT NULL and
 * `app.ensure_profile()` refuses an identity without an address, so an account that skipped this
 * could not store a single answer. The requirement is the schema's, not this screen's.
 */
export function AttachEmailStep({ onDone }: { onDone: () => void }) {
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
      await attachEmail(normalized);
      setSentTo(normalized);
      setStep("code");
      setCooldown(RESEND_COOLDOWN_SECONDS);
      if (resend) setCode("");
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
      await verifyAttachedEmail(sentTo, entered);
      onDone();
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
    if (digits.length === OTP_LENGTH && !busy) void verify(digits);
  }

  return (
    <View style={styles.wrap}>
      {step === "address" ? (
        <>
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
            editable={!busy}
            onSubmitEditing={() => void send(email, false)}
          />
          <Button
            label={busy ? "Sending…" : "Send code"}
            onPress={() => void send(email, false)}
            disabled={busy || email.trim().length === 0}
            style={styles.wide}
          />
        </>
      ) : (
        <>
          <Text style={styles.sentLine}>{`Enter the code sent to ${sentTo ?? ""}.`}</Text>
          <Input
            ref={codeRef}
            label={`${OTP_LENGTH}-digit code`}
            value={code}
            onChangeText={onCodeChange}
            placeholder="000000"
            keyboardType="number-pad"
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
        </>
      )}

      {busy ? <ActivityIndicator color={t.lavender} /> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const useStyles = themedStyles((t) => ({
  wrap: { gap: 14, alignItems: "stretch" },
  wide: { alignSelf: "stretch", minHeight: 48 },
  sentLine: { color: t.textSoft, fontFamily: FONT_BODY.regular, fontSize: 13, lineHeight: 20 },
  codeField: { fontSize: 22, letterSpacing: 8, textAlign: "center", minHeight: 56 },
  resend: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: 12 },
  resendPressed: { opacity: 0.6 },
  resendReady: { color: t.cobalt, fontFamily: FONT_BODY.semiBold, fontSize: 12.5 },
  resendWaiting: { color: t.muted2, fontFamily: FONT_BODY.regular, fontSize: 12.5 },
  error: { color: t.bad, fontFamily: FONT_BODY.regular, fontSize: 12.5, lineHeight: 19 },
}));
