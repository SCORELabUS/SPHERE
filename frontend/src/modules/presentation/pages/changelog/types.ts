export interface Change {
    id: string;
    message: string;
}

export interface ChangeSection {
    name: string | null;
    features: Change[];
    fixes: Change[];
}

export interface Release {
    version: string;
    release_date: string;
    description: string;
    commit_id: string;
    sections: ChangeSection[];
}
