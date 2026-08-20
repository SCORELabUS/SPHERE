import { LoginFormProps } from "../components/login-form";
import { RegisterFormProps } from "../components/register-form";

export const USERS_BASE_PATH = import.meta.env.VITE_API_URL + "/users";

export type RegistrationResponse = {
    user: { username: string; email: string };
    emailVerificationRequired: true;
    emailSent: boolean;
    message: string;
};

export function loginUser(formData: LoginFormProps): Promise<any> {
    return fetch(`${USERS_BASE_PATH}/login`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
    }).then(async (response) => {
        const parsedResponse = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(parsedResponse.error || "Invalid credentials");
        }
        return parsedResponse;
    })
    .catch((error) => {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    });
}

export function registerUser(
    formData: RegisterFormProps,
    setErrors: (errors: string[]) => void = () => {}
): Promise<RegistrationResponse> {
    return fetch(`${USERS_BASE_PATH}/register`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
    }).then(async (response) => {

        const parsedResponse = await response.json();

        if (!response.ok) {
            throw new Error(parsedResponse.error);
        }
        
        return parsedResponse;
    })
    .catch((error: Error) => {
        setErrors([error.message]);
        return Promise.reject(error);
    });
}

export function verifyEmail(token: string): Promise<{ message: string }> {
    return fetch(`${USERS_BASE_PATH}/email-verification/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
    }).then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "The verification link is invalid or has expired");
        return body;
    });
}

export function resendEmailVerification(loginField: string): Promise<{ message: string }> {
    return fetch(`${USERS_BASE_PATH}/email-verification/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginField }),
    }).then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Could not request another verification email");
        return body;
    });
}

export function forgotPassword(loginField: string): Promise<{ message: string }> {
    return fetch(`${USERS_BASE_PATH}/password/forgot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginField }),
    }).then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Could not request a password reset email");
        return body;
    });
}

export function resetPassword(token: string, password: string): Promise<{ message: string }> {
    return fetch(`${USERS_BASE_PATH}/password/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
    }).then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "The password reset link is invalid or has expired");
        return body;
    });
}

export function exchangeSsoCode(code: string): Promise<{ token: string }> {
    return fetch(`${USERS_BASE_PATH}/auth/sso/us/exchange?code=${encodeURIComponent(code)}`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
        },
    }).then(async (response) => {
        const parsedResponse = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(parsedResponse.error || "SSO exchange failed");
        }
        return parsedResponse;
    });
}

export function getCurrentUser(token: string): Promise<any> {
    return fetch(`${USERS_BASE_PATH}/me`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
    }).then(async (response) => {
        const parsedResponse = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(parsedResponse.error || "Could not retrieve session user");
        }
        return parsedResponse;
    });
}
