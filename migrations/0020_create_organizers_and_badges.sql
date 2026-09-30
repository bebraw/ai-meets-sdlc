CREATE TABLE organizers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  photo TEXT NOT NULL DEFAULT '',
  visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1)),
  badge INTEGER NOT NULL DEFAULT 0 CHECK (badge IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
INSERT INTO organizers (id,name,company,photo,visible,badge,position,updated_at) VALUES ('juho','Juho Vepsäläinen','','/assets/organizers/juho.webp',1,0,0,'2026-09-30T00:00:00Z');
INSERT INTO organizers (id,name,company,photo,visible,badge,position,updated_at) VALUES ('eemeli','Eemeli Aro','','/assets/organizers/eemeli.webp',1,0,1,'2026-09-30T00:00:00Z');
INSERT INTO organizers (id,name,company,photo,visible,badge,position,updated_at) VALUES ('harri','Harri Määttä','','/assets/organizers/harri.webp',1,0,2,'2026-09-30T00:00:00Z');
INSERT INTO organizers (id,name,company,photo,visible,badge,position,updated_at) VALUES ('toni','Toni Ristola','','/assets/organizers/toni.webp',1,0,3,'2026-09-30T00:00:00Z');
INSERT INTO organizers (id,name,company,photo,visible,badge,position,updated_at) VALUES ('tuuli','Tuuli Tiilikainen','','/assets/organizers/tuuli.webp',1,0,4,'2026-09-30T00:00:00Z');
INSERT INTO organizers (id,name,company,photo,visible,badge,position,updated_at) VALUES ('juhis','Juha-Matti Santala','','/assets/organizers/juhis.webp',1,0,5,'2026-09-30T00:00:00Z');
INSERT INTO organizers (id,name,company,photo,visible,badge,position,updated_at) VALUES ('emilia','Emilia Hjelm','','/assets/organizers/emilia.webp',1,0,6,'2026-09-30T00:00:00Z');
INSERT INTO organizers (id,name,company,photo,visible,badge,position,updated_at) VALUES ('jussi','Jussi Kinnula','','/assets/organizers/jussi.webp',1,0,7,'2026-09-30T00:00:00Z');
INSERT INTO organizers (id,name,company,photo,visible,badge,position,updated_at) VALUES ('elsa','Elsa Nyrhinen','','/assets/organizers/elsa.webp',1,0,8,'2026-09-30T00:00:00Z');

CREATE TABLE badge_workspace (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  ciphertext TEXT,
  iv TEXT,
  updated_at TEXT NOT NULL
);
INSERT INTO badge_workspace (id, updated_at) VALUES (1, '2026-09-30T00:00:00Z');
