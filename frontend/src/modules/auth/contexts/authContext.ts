import { createContext } from "react";
import { AuthUserContext } from "../hooks/useAuth";

type SetAuthUserFn = (prev: AuthUserContext | ((prev: AuthUserContext) => AuthUserContext)) => void;

interface AuthContextInterface {
    authUser: AuthUserContext;
    setAuthUser: SetAuthUserFn;
}

export const AuthContext = createContext<AuthContextInterface>({
    authUser: {
        user: null,
        isAuthenticated: false,
        token: null,
        tokenExpiration: null,
        isLoading: true
    },
    setAuthUser: () => {},
});
