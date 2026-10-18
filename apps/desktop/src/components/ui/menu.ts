/** 下拉菜单项（Menu.vue / 各处选择器共用） */
export interface MenuItem {
  value: string
  label: string
  hint?: string
  disabled?: boolean
}
