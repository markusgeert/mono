DROP TABLE IF EXISTS "user",
"issue",
"comment",
"label",
"issueLabel" CASCADE;

CREATE TABLE "user" (
    "id" VARCHAR PRIMARY KEY,
    "login" VARCHAR NOT NULL,
    "name" VARCHAR NOT NULL,
    "avatar" VARCHAR,
    "role" VARCHAR DEFAULT 'user' NOT NULL,
    "githubID" INTEGER NOT NULL
);

CREATE UNIQUE INDEX user_login_idx ON "user" (login);

CREATE TABLE issue (
    "id" VARCHAR PRIMARY KEY,
    "title" VARCHAR NOT NULL,
    "open" BOOLEAN NOT NULL,
    "modified" double precision DEFAULT (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000),
    "created" double precision DEFAULT (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000),
    "creatorID" VARCHAR REFERENCES "user"(id) NOT NULL,
    "description" TEXT DEFAULT '',
    -- This is a denormalized column that contains a comma-separated list of
    -- label IDs. This is temporary until Zero imlements support for filter-by-
    -- subquery. It does demonstrate the utility of connecting to existing
    -- mature databases though: we can use all the neat features of Postgres and
    -- Zero faithfully replicates whatever they do.
    --
    -- NULL here represents no labels. Empty string represents a single label
    -- with value "".
    "labelIDs" TEXT
);

CREATE TABLE comment (
    id VARCHAR PRIMARY KEY,
    "issueID" VARCHAR REFERENCES issue(id) ON DELETE CASCADE,
    "created" double precision,
    "body" TEXT NOT NULL,
    "creatorID" INTEGER REFERENCES "user"(id)
);

CREATE TABLE label (
    "id" VARCHAR PRIMARY KEY,
    "name" VARCHAR NOT NULL
);

CREATE TABLE "issueLabel" (
    "id" VARCHAR PRIMARY KEY,
    "labelID" VARCHAR REFERENCES label(id),
    "issueID" VARCHAR REFERENCES issue(id) ON DELETE CASCADE
);

-- last modified function and trigger
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.modified = (EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) * 1000);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_last_modified
BEFORE UPDATE ON issue
FOR EACH ROW
EXECUTE FUNCTION update_modified_column();


-- We use a trigger to maintain the "labelIDs" column in the issue table.
-- Add a new column to store labelIDs
CREATE OR REPLACE FUNCTION update_issue_labelIDs()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' OR TG_OP = 'UPDATE' THEN
        -- Use OLD when the operation is DELETE to access the old issueID
        UPDATE issue
        SET "labelIDs" = (
            SELECT STRING_AGG("labelID", ',')
            FROM "issueLabel"
            WHERE "issueID" = OLD."issueID"
        )
        WHERE id = OLD."issueID";
    END IF;
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        -- For INSERT or UPDATE, use NEW to access the current issueID
        UPDATE issue
        SET "labelIDs" = (
            SELECT STRING_AGG("labelID", ',')
            FROM "issueLabel"
            WHERE "issueID" = NEW."issueID"
        )
        WHERE id = NEW."issueID";
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger for INSERT operation
CREATE TRIGGER update_labelIDs_on_insert
AFTER
INSERT
    ON "issueLabel" FOR EACH ROW EXECUTE FUNCTION update_issue_labelIDs();

-- Trigger for UPDATE operation
CREATE TRIGGER update_labelIDs_on_update
AFTER
UPDATE
    ON "issueLabel" FOR EACH ROW EXECUTE FUNCTION update_issue_labelIDs();

-- Trigger for DELETE operation
CREATE TRIGGER update_labelIDs_on_delete
AFTER
    DELETE ON "issueLabel" FOR EACH ROW EXECUTE FUNCTION update_issue_labelIDs();

COPY "user"
FROM
    '/docker-entrypoint-initdb.d/users.csv' WITH CSV HEADER;

COPY "label"
FROM
    '/docker-entrypoint-initdb.d/labels.csv' WITH CSV HEADER;

COPY "issue"
FROM
    '/docker-entrypoint-initdb.d/issues.csv' WITH CSV HEADER;

COPY "issueLabel"
FROM
    '/docker-entrypoint-initdb.d/issue_labels.csv' WITH CSV HEADER;

COPY "comment"
FROM
    '/docker-entrypoint-initdb.d/comments.csv' WITH CSV HEADER;

-- We have to manually update the "labelIDs" column in the issue table because
-- COPY doesn't run triggers.
UPDATE
    issue
SET
    "labelIDs" = (
        SELECT
            STRING_AGG("labelID", ',')
        FROM
            "issueLabel"
        WHERE
            "issueID" = issue.id
    );

-- Create the indices on upstream so we can copy to downstream on replication.
-- We have discussed that, in the future, the indices of the Zero replica
-- can / should diverge from the indices of the upstream. This is because
-- the Zero replica could be serving a different set of applications than the
-- upstream. If that is true, it would be beneficial to have indices dedicated
-- to those use cases. This may not be true, however.
--
-- Until then, I think it makes the most sense to copy the indices from upstream
-- to the replica. The argument in favor of this is that it gives the user a single
-- place to manage indices and it saves us a step in setting up our demo apps.
CREATE INDEX issuelabel_issueid_idx ON "issueLabel" ("issueID");

CREATE INDEX issue_modified_idx ON issue (modified);

CREATE INDEX issue_created_idx ON issue (created);

CREATE INDEX issue_open_modified_idx ON issue (open, modified);

CREATE INDEX comment_issueid_idx ON "comment" ("issueID");

SELECT
    *
FROM
    pg_create_logical_replication_slot('zero_slot_r1', 'pgoutput');

VACUUM;