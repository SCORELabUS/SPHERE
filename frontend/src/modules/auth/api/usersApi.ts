import { LoginFormProps } from "../components/login-form";
import { RegisterFormProps } from "../components/register-form";

export const USERS_BASE_PATH = import.meta.env.VITE_API_URL + "/users";

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

export function registerUser(formData: RegisterFormProps, setErrors: Function = () => {}): Promise<any> {
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
        if (Array.isArray(error)) {
            setErrors(error);
        }else{
            setErrors([error.message]);
        }
        return Promise.reject(error);
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
