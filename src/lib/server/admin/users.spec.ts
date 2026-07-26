import { describe, expect, it } from 'vitest'
import { parseAdminUsersDir, parseAdminUsersLimit, parseAdminUsersPage, parseAdminUsersSort } from './users'

describe('parseAdminUsersPage', () => {
	it('defaults to 1 for null, empty, or invalid', () => {
		expect(parseAdminUsersPage(null)).toBe(1)
		expect(parseAdminUsersPage(undefined)).toBe(1)
		expect(parseAdminUsersPage('')).toBe(1)
		expect(parseAdminUsersPage('abc')).toBe(1)
		expect(parseAdminUsersPage('0')).toBe(1)
		expect(parseAdminUsersPage('-3')).toBe(1)
	})

	it('parses positive page numbers', () => {
		expect(parseAdminUsersPage('3')).toBe(3)
		expect(parseAdminUsersPage('1')).toBe(1)
	})
})

describe('parseAdminUsersLimit', () => {
	it('defaults to 50 for null, empty, or invalid', () => {
		expect(parseAdminUsersLimit(null)).toBe(50)
		expect(parseAdminUsersLimit(undefined)).toBe(50)
		expect(parseAdminUsersLimit('')).toBe(50)
		expect(parseAdminUsersLimit('abc')).toBe(50)
	})

	it('clamps to [1, 200]', () => {
		expect(parseAdminUsersLimit('0')).toBe(1)
		expect(parseAdminUsersLimit('-5')).toBe(1)
		expect(parseAdminUsersLimit('200')).toBe(200)
		expect(parseAdminUsersLimit('999')).toBe(200)
	})

	it('accepts values in range', () => {
		expect(parseAdminUsersLimit('50')).toBe(50)
		expect(parseAdminUsersLimit('25')).toBe(25)
	})
})

describe('parseAdminUsersSort', () => {
	it('round-trips known sort keys', () => {
		expect(parseAdminUsersSort('createdAt')).toBe('createdAt')
		expect(parseAdminUsersSort('email')).toBe('email')
		expect(parseAdminUsersSort('totalCreditsDebited')).toBe('totalCreditsDebited')
		expect(parseAdminUsersSort('totalGatewayCostUsd')).toBe('totalGatewayCostUsd')
		expect(parseAdminUsersSort('lastActivityAt')).toBe('lastActivityAt')
	})

	it('defaults unknown keys to createdAt', () => {
		expect(parseAdminUsersSort(null)).toBe('createdAt')
		expect(parseAdminUsersSort(undefined)).toBe('createdAt')
		expect(parseAdminUsersSort('')).toBe('createdAt')
		expect(parseAdminUsersSort('garbage')).toBe('createdAt')
		expect(parseAdminUsersSort('billingMode')).toBe('createdAt')
	})
})

describe('parseAdminUsersDir', () => {
	it('accepts asc and desc case-insensitively', () => {
		expect(parseAdminUsersDir('asc')).toBe('asc')
		expect(parseAdminUsersDir('desc')).toBe('desc')
		expect(parseAdminUsersDir('ASC')).toBe('asc')
		expect(parseAdminUsersDir('DESC')).toBe('desc')
	})

	it('defaults garbage to desc', () => {
		expect(parseAdminUsersDir(null)).toBe('desc')
		expect(parseAdminUsersDir(undefined)).toBe('desc')
		expect(parseAdminUsersDir('')).toBe('desc')
		expect(parseAdminUsersDir('up')).toBe('desc')
	})
})
