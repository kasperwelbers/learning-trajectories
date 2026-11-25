import { useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { useState, type FormEvent } from "react"
import { apiSend, errorMessage } from "@/api/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/** Two steps: request a code by e-mail, then enter it. */
export function LoginPage() {
  const { redirect } = useSearch({ from: "/login" })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"email" | "code">("email")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (step === "email") {
        await apiSend("POST", "/api/auth/request-code", { email })
        setStep("code")
      } else {
        await apiSend("POST", "/api/auth/verify-code", { email, code })
        await queryClient.invalidateQueries()
        await navigate({ to: redirect ?? "/" })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={(e) => void submit(e)} className="w-full max-w-sm space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-semibold">Learning Trajectories</h1>
          <p className="text-sm text-muted-foreground">
            {step === "email"
              ? "Log in with your university e-mail address. We will send you a code."
              : `We sent a 6-digit code to ${email}.`}
          </p>
        </div>
        {step === "email" ? (
          <div className="space-y-2">
            <Label htmlFor="email">E-mail address</Label>
            <Input id="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="code">Code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="text-center font-mono text-2xl tracking-[0.5em]"
            />
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" className="w-full" disabled={busy}>
          {step === "email" ? "Send code" : "Log in"}
        </Button>
        {step === "code" && (
          <button type="button" className="w-full text-sm text-muted-foreground hover:underline" onClick={() => setStep("email")}>
            Use another address
          </button>
        )}
      </form>
    </div>
  )
}
