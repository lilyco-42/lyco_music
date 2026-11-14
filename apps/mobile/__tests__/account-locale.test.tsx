import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import AccountScreen from '../src/screens/AccountScreen'
import { setLocale } from '../src/lib/i18n'

jest.mock('../src/account', () => ({
  accessToken: jest.fn(async () => null),
  profile: jest.fn(async () => null),
  requestDeviceCode: jest.fn(async () => ({
    user_code: 'ABCD1234',
    verification_uri_complete: 'https://example.test/confirm',
    expires_in: 300,
  })),
  pollDeviceToken: jest.fn(async () => new Promise(() => undefined)),
  cancelPolling: jest.fn(),
  signOut: jest.fn(async () => undefined),
  VERIFICATION_URI: 'https://example.test/confirm',
}))

describe('账户页语言切换', () => {
  afterEach(async () => { await setLocale('zh-CN') })

  it('默认显示简体，点击 English 后整页与我的音乐共享同一语言', async () => {
    await setLocale('zh-CN')
    render(<AccountScreen />)
    expect(await screen.findByText('我的账户')).toBeTruthy()
    expect(screen.getByText('界面语言')).toBeTruthy()

    fireEvent.press(screen.getByText('English'))
    await waitFor(() => expect(screen.getByText('My Account')).toBeTruthy())
    expect(screen.getByText('Language')).toBeTruthy()
    expect(screen.getByText('Sign in with lain42.top account')).toBeTruthy()
  })
})
