import type { laundryReportsApi } from '../api/laundryReportsApi'
import type { StoreSetting } from '../types'
import { buildReportPdf, type ReportExportData } from '../utils/reportExport'
import { saveFile } from '../utils/fileExport'

export type LaundryReport = Awaited<ReturnType<typeof laundryReportsApi.report>>
export function laundryReportExport(
  data: LaundryReport,
  settings: StoreSetting,
  from: string,
  to: string,
): ReportExportData {
  const total = data.collections.reduce((sum, row) => sum + row.amount_cents, 0)
  const money = (value: number) => (value / 100).toFixed(2)
  return {
    title: 'Laundry report',
    paymentCountLabel: 'Payments',
    itemSectionTitle: 'Revenue by service and add-on (booked, after discounts)',
    itemLabel: 'Service / add-on',
    itemValueLabel: 'Net value',
    transactionSectionTitle: 'Collected payments',
    documentLabel: 'Order',
    storeName: settings.storeName,
    currency: settings.currency,
    periodLabel: `${from} to ${to}`,
    filtersLabel:
      'Collections by payment date; order value by received date. Outstanding balances are current.',
    generatedAt: new Date(),
    summary: [
      { label: 'Collected in period', value: total / 100, kind: 'money' },
      {
        label: 'Order value in period',
        value: data.orders.reduce((sum, row) => sum + row.value, 0) / 100,
        kind: 'money',
      },
      {
        label: 'Orders received',
        value: data.orders.reduce((sum, row) => sum + row.count, 0),
        kind: 'count',
      },
      { label: 'Outstanding now', value: data.outstanding / 100, kind: 'money' },
    ],
    paymentMethods: ['Cash', 'GCash', 'Maya'].map((method) => ({
      label: method === 'Cash' ? method : `${method} (manual)`,
      count: data.collections.filter((row) => row.method === method).length,
      amount:
        data.collections
          .filter((row) => row.method === method)
          .reduce((sum, row) => sum + row.amount_cents, 0) / 100,
    })),
    topProducts: data.services.map((row) => ({
      name: `${row.name} (${row.pricing}${row.kind ? ', add-on' : ''})`,
      quantity: row.quantity_milli / 1000,
      revenue: row.net_value / 100,
    })),
    transactions: data.collections.map((row) => ({
      date: new Date(row.created_at),
      invoice: row.order_number,
      customer: row.customer_name,
      cashier: row.staff,
      orderType: 'Laundry',
      payment: row.method,
      status: row.method === 'Cash' ? 'Recorded' : 'Manual',
      items: 0,
      subtotal: row.amount_cents / 100,
      discount: 0,
      tax: 0,
      total: row.amount_cents / 100,
    })),
    additionalTables: [
      {
        title: 'Order status (received in period)',
        headers: ['Status', 'Orders', 'Order value'],
        rows: data.orders.map((row) => [
          row.status,
          String(row.count),
          `${settings.currency} ${money(row.value)}`,
        ]),
      },
      {
        title: 'Outstanding balances (all dates, current)',
        headers: ['Order', 'Customer', 'Balance'],
        rows: data.balances.map((row) => [
          row.order_number,
          row.customer_name,
          `${settings.currency} ${money(row.balance)}`,
        ]),
      },
    ],
  }
}
export function laundryCsv(data: LaundryReport, settings: StoreSetting, from: string, to: string) {
  const rows: (string | number)[][] = [
    ['Laundry report'],
    ['Store', settings.storeName],
    ['Currency', settings.currency],
    ['Period', from, to],
    ['Collections use payment dates. Service value is before discounts. Outstanding balances are current.'],
    [],
    ['Collections'],
    [
      'Payment ID',
      'Date',
      'Order',
      'Customer',
      'Method',
      'Amount collected',
      'Staff',
      'Reference',
      'Provider verification',
    ],
  ]
  data.collections.forEach((row) =>
    rows.push([
      row.id,
      row.created_at,
      row.order_number,
      row.customer_name,
      row.method,
      (row.amount_cents / 100).toFixed(2),
      row.staff,
      row.reference ?? '',
      row.method === 'Cash' ? 'Not applicable' : 'Manual / unverified',
    ]),
  )
  rows.push(
    [],
    ['Orders received in period'],
    ['Status', 'Orders', 'Order value after discount (legacy archives excluded)'],
  )
  data.orders.forEach((row) => rows.push([row.status, row.count, (row.value / 100).toFixed(2)]))
  rows.push(
    [],
    ['Booked revenue in period (not payment collections)'],
    ['Service / add-on', 'Pricing', 'Kind', 'Quantity', 'Gross value', 'Net value after allocated discount'],
  )
  data.services.forEach((row) =>
    rows.push([
      row.name,
      row.pricing,
      row.kind ? 'Add-on' : 'Service',
      row.quantity_milli / 1000,
      (row.value / 100).toFixed(2),
      (row.net_value / 100).toFixed(2),
    ]),
  )
  rows.push([], ['Outstanding balances now (all dates)'], ['Order', 'Customer', 'Balance'])
  data.balances.forEach((row) =>
    rows.push([row.order_number, row.customer_name, (row.balance / 100).toFixed(2)]),
  )
  rows.push(['Total outstanding', (data.outstanding / 100).toFixed(2)])
  const cell = (value: string | number) => {
    const text = String(value)
    return `"${(/^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"`
  }
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n')
}
export async function exportLaundryReport(
  format: 'csv' | 'pdf',
  data: LaundryReport,
  settings: StoreSetting,
  from: string,
  to: string,
) {
  return saveFile({
    filename: `Laundry_Report_${from}_${to}.${format}`,
    mimeType: format === 'pdf' ? 'application/pdf' : 'text/csv;charset=utf-8',
    content:
      format === 'pdf'
        ? buildReportPdf(laundryReportExport(data, settings, from, to))
        : laundryCsv(data, settings, from, to),
  })
}
