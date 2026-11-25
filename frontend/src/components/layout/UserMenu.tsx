import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { LogOut, UserRound } from "lucide-react"
import { apiSend } from "@/api/client"
import { queries } from "@/api/queries"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function UserMenu() {
  const me = useQuery(queries.me())
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const user = me.data?.user

  if (!user) {
    return (
      <Button size="sm" variant="outline" asChild>
        <Link to="/login" search={{ redirect: location.pathname }}>
          Log in
        </Link>
      </Button>
    )
  }

  const logout = async () => {
    await apiSend("POST", "/api/auth/logout")
    queryClient.clear()
    await navigate({ to: "/login" })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Account">
          <UserRound />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{user.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/">All programmes</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
