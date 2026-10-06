-- Canonical source changes invalidate outstanding registration confirmations.
CREATE TRIGGER registration_volunteer_added AFTER INSERT ON volunteers
BEGIN UPDATE attendee_roster SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER registration_volunteer_updated AFTER UPDATE ON volunteers
BEGIN UPDATE attendee_roster SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER registration_volunteer_deleted AFTER DELETE ON volunteers
BEGIN UPDATE attendee_roster SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER registration_poster_added AFTER INSERT ON poster_proposals
WHEN NEW.status = 'accepted'
BEGIN UPDATE attendee_roster SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER registration_poster_updated AFTER UPDATE ON poster_proposals
WHEN NEW.status = 'accepted' OR OLD.status = 'accepted'
BEGIN UPDATE attendee_roster SET revision = revision + 1 WHERE id = 1; END;
CREATE TRIGGER registration_poster_deleted AFTER DELETE ON poster_proposals
WHEN OLD.status = 'accepted'
BEGIN UPDATE attendee_roster SET revision = revision + 1 WHERE id = 1; END;
-- Keep the original audit events when a generated entry gains a ticket identity.
CREATE TRIGGER registration_arrival_identity_updated AFTER UPDATE OF attendee_id ON attendee_arrivals
WHEN OLD.attendee_id IS NOT NEW.attendee_id
BEGIN UPDATE attendee_arrival_events SET attendee_id = NEW.attendee_id WHERE attendee_id = OLD.attendee_id; END;
