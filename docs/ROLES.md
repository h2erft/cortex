# Roles and permissions

Since 1.7.1-beta.7 a role is a **named list of permissions**, kept with the site like a template. Every
user of a role can see and do exactly what that role allows. Change the role and all its users change.

## Where

**Settings ▸ Users**. The top half is the users, the bottom half is the roles: **New role**, **Edit**,
**Copy**, **Delete**. Adding or editing a user offers every role by name.

## root

The account made in the setup wizard used to be labelled *owner*. It is now **root**. It always has every
permission and cannot be edited or deleted, so a site can never lock itself out. (Its stored role id is
still `owner`, so older backups restore unchanged.)

## The starting roles

A site upgraded to this version gets the three roles it always had, **Admin**, **Technician** and
**Customer**, with the same abilities as before. The old switches "Allow customer control" and "Allow
customer All on / All off" are carried into the Customer role and then removed from Advanced settings.
After that these are ordinary roles: rename them, change them, or delete them.

## The permissions

| Group | Permission | Allows |
|---|---|---|
| Units | Control units | On/off, mode, temperature, fan. Without it: look but not change |
| | All on / All off | The two buttons |
| | Control units in service | Change a unit marked as being serviced |
| | Thermostat locks | Lock and unlock wall thermostats |
| | Edit units | Rename, regroup, change type, reset the filter reminder |
| | Service mode and notes | Mark in service, write notes |
| | Technical details | Addresses, system numbers, raw data |
| Pages | Building map / Edit the layout | The map, and floor plans and placement |
| | Schedules / Edit schedules | See them, and change them |
| | Fault history, Device health | Those pages |
| | Rheem / Ruud / Control Rheem / Ruud | The page, and changing settings on it |
| Technician tools | Outdoor / cycle, Bus scan, UART service port, Set up Rheem / Ruud | Each tool separately |
| Administration | Advanced settings, Users and roles, Update channel, Backup and restore, Clear data and factory reset | Each separately |

## Rules that protect the site

- A role that still has users cannot be deleted. Move the users first.
- You cannot remove "Users and roles" from your own role, or move yourself to a role without it.
- A user whose role was deleted elsewhere can only look, and Settings ▸ Users says so.
- `root` and `owner` are reserved names.
- The admin and technician access codes still work: for that session they add what the standard Admin
  or Technician role has.

## What this is not

Permissions decide what the Cortex screens show and allow. Signing in is checked in the browser, as it
always has been, and the controller's own API does not ask who is calling. Roles keep people on a
trusted network from seeing or changing things they should not; they are not protection against
someone on that network who talks to the controller directly. Keep controllers off the open internet.

## For developers

`PERMS`, `ROLE_DEFAULTS`, `seedRoles()`, `roles()`, `rolePerms()`, `can()` in `cortex.html`. Everything
asks `can("key")`; nothing checks a role name. `session.admin` / `session.tech` remain as rough
summaries for old call sites only. Roles live in `CFG.roles` and travel in the logins part of a backup.
Tests: `tests/roles.test.js`.
