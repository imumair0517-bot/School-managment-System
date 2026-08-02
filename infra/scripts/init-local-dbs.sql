-- Local dev only. Production tenant databases are created one-per-tenant
-- by the automated provisioning pipeline (Phase 9 §3), never by a static
-- init script like this one.
CREATE DATABASE school_os_platform;
CREATE DATABASE school_os_tenant_greenvalley;
