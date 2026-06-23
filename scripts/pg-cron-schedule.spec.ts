import { describe, expect, it } from 'vitest';
import {
	buildHttpPostCommand,
	buildScheduleSql,
	buildSetCronTimezoneSql,
	cronTimezonesEquivalent,
	databaseNameFromUrl,
	escapePgLiteral,
	normalizeCronTimezone
} from './pg-cron-schedule.mjs';

describe('normalizeCronTimezone', () => {
	it('treats GMT and UTC as equivalent', () => {
		expect(normalizeCronTimezone('GMT')).toBe('UTC');
		expect(normalizeCronTimezone('UTC')).toBe('UTC');
		expect(cronTimezonesEquivalent('GMT', 'UTC')).toBe(true);
	});
});

describe('escapePgLiteral', () => {
	it('doubles single quotes', () => {
		expect(escapePgLiteral("it's")).toBe("it''s");
	});
});

describe('buildHttpPostCommand', () => {
	it('escapes admin key and URL in the http_post command', () => {
		const sql = buildHttpPostCommand({
			url: "http://app:3000/api/admin/consolidate?x='1'",
			adminKey: "key'with'quotes"
		});
		expect(sql).toContain("url := 'http://app:3000/api/admin/consolidate?x=''1'''");
		expect(sql).toContain("'X-Admin-Key', 'key''with''quotes'");
		expect(sql).toContain('net.http_post');
	});
});

describe('buildScheduleSql', () => {
	it('uses cron.schedule (not schedule_in_timezone)', () => {
		const sql = buildScheduleSql({
			jobName: 'eigen-sleep-consolidation',
			schedule: '0 2 * * *',
			command: 'SELECT 1'
		});
		expect(sql).toContain('cron.schedule(');
		expect(sql).not.toContain('schedule_in_timezone');
		expect(sql).toContain("'eigen-sleep-consolidation'");
		expect(sql).toContain("'0 2 * * *'");
	});
});

describe('buildSetCronTimezoneSql', () => {
	it('sets database-level cron.timezone', () => {
		const sql = buildSetCronTimezoneSql('eigen', 'UTC');
		expect(sql).toBe(`ALTER DATABASE "eigen" SET cron.timezone TO 'UTC'`);
	});

	it('escapes database name and timezone literals', () => {
		const sql = buildSetCronTimezoneSql('db"name', "America/New_York");
		expect(sql).toContain('ALTER DATABASE "db""name"');
		expect(sql).toContain("TO 'America/New_York'");
	});
});

describe('databaseNameFromUrl', () => {
	it('extracts database name from postgres URL', () => {
		expect(databaseNameFromUrl('postgres://eigen:eigen@localhost:5432/eigen')).toBe('eigen');
	});
});
