# ADR-011: Manage organizers and validated badge printing

- Status: Implemented
- Date: 2026-09-30

## Context and trigger

The event needs one badge list combining Tito and Webropol attendee CSVs with speakers, organizers, and volunteers. Previous badge runs had clipped long names and missing characters. Only some homepage organizers attend, so homepage membership must not automatically create a badge.

## Decision

D1 is the canonical store for organizer names, optional company and local photo paths, public visibility, display order, and private badge inclusion. Migration 0020 seeds the nine existing homepage organizers. All remain visible, with badge inclusion initially off. The homepage renders public organizer fields from D1, falling back to bundled seed cards if storage is unavailable. Later deployments do not overwrite administrator edits.

The badge workspace is a separate, encrypted D1 snapshot containing up to 2,000 badge records and print settings. Explicit saves use revision comparisons to prevent lost updates. Admin authentication, same-origin mutation checks, and no-store responses follow existing private tools. Activity events contain categories and actions, not attendee values. A downloadable JSON draft provides a manual backup and restore path. Clearing the badge list and saving removes the saved attendee snapshot contents.

CSV import happens in the browser. Tito name/company/email columns are recognized, while column mapping, comma/semicolon/tab delimiters, and separate first/last-name mappings support other exports. Invalid CSV imports fail as a whole. Imported Unicode names are normalized to NFC without transliteration. Matching nonempty attendee emails are flagged; records are never merged by name. Administrators exclude extra badges or explicitly retain duplicates.

Source refreshes replace that source's badge text, preserve existing inclusion choices, and remove records no longer in the source. Speakers exclude workspace-only test accounts. Organizers include only selected attendees. Volunteers use the organizer color and can be individually excluded. Badge-only edits do not alter the original source records.

## Print contract

Default output is one 100 mm square page per circular badge, with a 5 mm circular safe inset and a 14 mm top exclusion. White/black denotes attendees, black/white speakers, and orange (#f58220)/black organizers. Printer controls cover diameter, bleed, safe inset, top clearance, name sizes, company size, a circular trim guide, and consecutive identical front/back pages.

The preview and print view use the same SVG renderer and loaded font. Text is measured using actual browser glyph metrics, wrapped at word or grapheme boundaries, and fitted above a configurable minimum size. Every text line is checked against its reserved vertical band and circular safe area. Logo, name, company, and role occupy separate bands. The bundled, openly licensed Noto Sans font covers extended Latin, Greek, and Cyrillic; its Unicode cmap is checked for missing characters. A local TTF/OTF can be loaded for other scripts. Custom fonts are tab-local and must be reloaded after reopening the workspace.

Preflight runs again before every print action and blocks output for unreadable fits, missing glyphs, invalid control characters, and unresolved duplicate emails. Long names and company names are not silently clipped or abbreviated. Browser PDF output retains vector text; it is RGB and not a CMYK/PDF-X publishing system. Print at 100% with backgrounds enabled, confirm printer tolerances, bleed, and duplex ordering, and approve a physical proof. Browser PDF page dimensions can be rounded slightly by the print engine.

## Validation and alternatives

Unit and integration tests cover CSV parsing, Unicode font coverage, duplicate decisions, authentication, encrypted persistence, stale writes, organizer seed data, and public rendering. The browser check exercises actual font measurement, long names, missing glyphs, imports, save/reload, source selection, mobile width, role colors, bleed, duplex page count, and print output. It is part of the full quality gate.

Character-count sizing was rejected because it cannot model glyph widths or diacritics. A browser-only unsaved list was rejected because reprints need durable edits. A full publishing service with CMYK conversion and printer-specific imposition is outside this initial format and can be added if the printer requires it.
