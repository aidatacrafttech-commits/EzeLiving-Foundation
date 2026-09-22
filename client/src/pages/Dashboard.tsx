import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarDays, LayoutDashboard, PackageX, Receipt, Truck, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import type { DamagedStockRow, DamageSource, LowStockRow, SalesSummary } from "../types";

const WAREHOUSE_COLORS = [
  "var(--brand-500)",
  "var(--success-dark)",
  "var(--warning-dark)",
  "var(--info-dark)",
  "var(--accent-purple)",
];

function ProductQtyTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: { name: string; sku: string; qty: number } }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-label">
        {row.name} <span className="muted small">({row.sku})</span>
      </div>
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-dot" style={{ background: "var(--brand-500)" }} />
        {row.qty} sold
      </div>
    </div>
  );
}

function WarehouseSalesTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; color?: string }> }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-row">
        <span className="chart-tooltip-dot" style={{ background: row.color }} />
        {row.name}: ₹{row.value.toFixed(2)}
      </div>
    </div>
  );
}

const DAMAGE_SOURCE_LABEL: Record<DamageSource, string> = {
  transit: "Damage on Transit",
  showroom: "Damage on Showroom",
};

export function Dashboard() {
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [damagedStock, setDamagedStock] = useState<DamagedStockRow[]>([]);
  const [damageSourceFilter, setDamageSourceFilter] = useState<DamageSource | "all">("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get<SalesSummary>("/reports/summary"),
      api.get<LowStockRow[]>("/stock/low"),
      api.get<DamagedStockRow[]>("/stock/damaged"),
    ])
      .then(([summaryRes, lowStockRes, damagedRes]) => {
        setSummary(summaryRes.data);
        setLowStock(lowStockRes.data);
        setDamagedStock(damagedRes.data);
      })
      .finally(() => setLoading(false));
  }, []);

  const totalTransitDamage = useMemo(
    () => damagedStock.filter((d) => d.damageSource === "transit").reduce((sum, d) => sum + d.damagedQuantity, 0),
    [damagedStock]
  );
  const totalShowroomDamage = useMemo(
    () => damagedStock.filter((d) => d.damageSource === "showroom").reduce((sum, d) => sum + d.damagedQuantity, 0),
    [damagedStock]
  );
  const filteredDamagedStock = useMemo(
    () => (damageSourceFilter === "all" ? damagedStock : damagedStock.filter((d) => d.damageSource === damageSourceFilter)),
    [damagedStock, damageSourceFilter]
  );

  if (loading) return <div className="page-loading">Loading dashboard...</div>;
  if (!summary) return null;

  return (
    <div className="dashboard-page">
      <h2>
        <LayoutDashboard size={19} /> Dashboard
      </h2>

      <div className="stat-cards">
        <div className="stat-card stat-sales-today">
          <span className="stat-icon">
            <CalendarDays size={20} />
          </span>
          <div>
            <span className="stat-label">Today's Sales</span>
            <span className="stat-value">₹{Number(summary.today.totalSales).toFixed(2)}</span>
            <span className="stat-sub">{summary.today.invoiceCount} invoice(s)</span>
          </div>
        </div>
        <div className="stat-card stat-sales-month">
          <span className="stat-icon">
            <TrendingUp size={20} />
          </span>
          <div>
            <span className="stat-label">This Month's Sales</span>
            <span className="stat-value">₹{Number(summary.thisMonth.totalSales).toFixed(2)}</span>
            <span className="stat-sub">{summary.thisMonth.invoiceCount} invoice(s)</span>
          </div>
        </div>
        <div className="stat-card stat-low-stock">
          <span className="stat-icon">
            <Receipt size={20} />
          </span>
          <div>
            <span className="stat-label">Low Stock Items</span>
            <span className="stat-value">{lowStock.length}</span>
            <span className="stat-sub">across all warehouses</span>
          </div>
        </div>
        <div className="stat-card stat-damaged">
          <span className="stat-icon">
            <PackageX size={20} />
          </span>
          <div>
            <span className="stat-label">Damaged Stock</span>
            <span className="stat-value">{totalTransitDamage + totalShowroomDamage}</span>
            <span className="stat-sub">
              {totalTransitDamage} transit · {totalShowroomDamage} showroom
            </span>
          </div>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <h3>Top Selling Products (this month)</h3>
          {summary.topProducts.length === 0 ? (
            <p className="muted" style={{ padding: "16px 0", textAlign: "center" }}>
              No sales yet this month.
            </p>
          ) : (
            <div style={{ width: "100%", height: Math.max(180, summary.topProducts.length * 40) }}>
              <ResponsiveContainer>
                <BarChart
                  data={summary.topProducts.map((p) => ({ name: p.productName, sku: p.sku, qty: p.qtySold }))}
                  layout="vertical"
                  margin={{ top: 4, right: 24, bottom: 4, left: 4 }}
                >
                  <CartesianGrid horizontal={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: "var(--muted)" }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={140}
                    tick={{ fontSize: 12, fill: "var(--text-soft)" }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={false}
                    tickFormatter={(name: string) => (name.length > 18 ? `${name.slice(0, 17)}…` : name)}
                  />
                  <Tooltip content={<ProductQtyTooltip />} cursor={{ fill: "var(--chip-bg)" }} />
                  <Bar dataKey="qty" fill="var(--brand-500)" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="dashboard-panel">
          <h3>Sales by Warehouse (this month)</h3>
          {summary.salesByWarehouse.length === 0 ? (
            <p className="muted" style={{ padding: "16px 0", textAlign: "center" }}>
              No sales yet this month.
            </p>
          ) : (
            <div style={{ width: "100%", height: 260 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={summary.salesByWarehouse.map((w) => ({ name: w.warehouseName, value: Number(w.totalSales) }))}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={3}
                    stroke="var(--surface)"
                    strokeWidth={2}
                  >
                    {summary.salesByWarehouse.map((w, i) => (
                      <Cell key={w.warehouseId} fill={WAREHOUSE_COLORS[i % WAREHOUSE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<WarehouseSalesTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    height={32}
                    wrapperStyle={{ fontSize: 12, color: "var(--text-soft)" }}
                    iconType="circle"
                    iconSize={8}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="dashboard-panel">
        <h3>
          <AlertTriangle size={16} /> Low Stock
        </h3>
        <table className="cart-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Warehouse</th>
              <th>Qty</th>
              <th>Reorder level</th>
            </tr>
          </thead>
          <tbody>
            {lowStock.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  Nothing is low on stock right now.
                </td>
              </tr>
            )}
            {lowStock.map((row) => (
              <tr key={`${row.productId}-${row.warehouseId}`} className={row.quantity === 0 ? "current-warehouse" : ""}>
                <td>
                  {row.productName} <span className="muted small">({row.sku})</span>
                </td>
                <td>{row.warehouseName}</td>
                <td>
                  {row.quantity}
                  {row.quantity === 0 ? (
                    <span className="out-of-stock-badge">out</span>
                  ) : (
                    <span className="low-stock-badge">low</span>
                  )}
                </td>
                <td>{row.reorderLevel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dashboard-panel" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h3 style={{ marginBottom: 0 }}>
            <PackageX size={16} /> Damaged Products
          </h3>
          <Link to="/admin/stock" className="inline-link small">
            Mark stock as damaged →
          </Link>
        </div>
        <p className="muted small" style={{ margin: "6px 0 10px" }}>
          <strong>Damage on Transit</strong> — arrived already damaged from the supplier, recorded at receiving and
          never added to sellable stock. <strong>Damage on Showroom</strong> — damaged after reaching the
          showroom/shop (handling, display, customer/staff mishap, or a defective customer return). Send either back
          to a supplier from Purchases → Return to Supplier.
        </p>

        <div className="mode-toggle" style={{ marginBottom: 10 }}>
          <button type="button" className={damageSourceFilter === "all" ? "active" : ""} onClick={() => setDamageSourceFilter("all")}>
            All ({totalTransitDamage + totalShowroomDamage})
          </button>
          <button
            type="button"
            className={damageSourceFilter === "transit" ? "active" : ""}
            onClick={() => setDamageSourceFilter("transit")}
          >
            <Truck size={13} /> Transit ({totalTransitDamage})
          </button>
          <button
            type="button"
            className={damageSourceFilter === "showroom" ? "active" : ""}
            onClick={() => setDamageSourceFilter("showroom")}
          >
            <PackageX size={13} /> Showroom ({totalShowroomDamage})
          </button>
        </div>

        <table className="cart-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Warehouse</th>
              <th>Damaged qty</th>
              <th>Damage Source</th>
              <th>Last updated</th>
            </tr>
          </thead>
          <tbody>
            {filteredDamagedStock.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No damaged/quarantined stock right now.
                </td>
              </tr>
            )}
            {filteredDamagedStock.map((row) => (
              <tr key={`${row.productId}-${row.warehouseId}-${row.damageSource}`}>
                <td>
                  {row.productName} <span className="muted small">({row.sku})</span>
                </td>
                <td>{row.warehouseName}</td>
                <td>
                  {row.damagedQuantity}
                  <span className="out-of-stock-badge">damaged</span>
                </td>
                <td>
                  {row.damageSource === "transit" ? (
                    <span className="low-stock-badge">
                      <Truck size={11} /> {DAMAGE_SOURCE_LABEL.transit}
                    </span>
                  ) : (
                    <span className="out-of-stock-badge">{DAMAGE_SOURCE_LABEL.showroom}</span>
                  )}
                </td>
                <td className="muted small">{new Date(row.updatedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
