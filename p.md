# Multi-Location POS & Smart Inventory System
### Product Design Specification (v1)

---

# Overview

The inventory system is designed to support businesses of all sizes—from a single retail shop to enterprise retailers with multiple warehouses and stores.

The core philosophy is:

> **Every inventory movement should be tracked at the location level, and every location can have different capabilities.**

This allows the platform to support:

- Single store businesses
- Multiple retail stores
- Warehouses
- Distribution centres
- Dark stores
- Hybrid online + offline businesses

without changing the underlying architecture.

---

# Core Concepts

## Location

A location represents any physical place where inventory exists.

Examples:

- Warehouse
- Delhi Store
- Mumbai Store
- Bangalore Store
- Distribution Centre
- Dark Store

Every location maintains its own inventory.

Example:

| Location | Product | Quantity |
|----------|----------|----------|
| Warehouse | iPhone 16 | 120 |
| Delhi | iPhone 16 | 15 |
| Mumbai | iPhone 16 | 8 |

---

# Location Capabilities

Every location can enable or disable different capabilities.

| Capability | Description |
|------------|-------------|
| POS | Can process walk-in sales |
| Online Fulfilment | Can fulfil website orders |
| Pick Up in Store | Customers can collect online orders from this location |
| Return in Store | Customers can return online purchases here |
| Receive Stock | Can receive inventory |
| Stock Transfer | Can send/receive inventory transfers |

Example

## Warehouse

```
POS ❌

Online Fulfilment ✅

Pick Up ❌

Return ❌

Receive Stock ✅

Transfer Stock ✅
```

## Delhi Store

```
POS ✅

Online Fulfilment ✅

Pick Up ✅

Return ✅

Receive Stock ✅

Transfer Stock ✅
```

## Mumbai Store

```
POS ✅

Online Fulfilment ❌

Pick Up ✅

Return ❌

Receive Stock ✅

Transfer Stock ✅
```

---

# Business Types Supported

## Case 1 — Single Store

Locations

```
Delhi Store
```

Capabilities

```
POS ✅

Online Fulfilment ✅

Pick Up ✅

Return ✅
```

Inventory

```
Delhi

Nike Shoes : 18
```

### Flow

- Walk-in customer buys shoes
- Inventory becomes 17

Website customer buys shoes

Inventory becomes 16

Everything happens from the same location.

---

## Case 2 — Warehouse + Retail Stores

Locations

```
Warehouse

Delhi

Mumbai
```

Capabilities

| Location | POS | Online | Pickup | Return |
|----------|-----|---------|---------|--------|
| Warehouse | ❌ | ✅ | ❌ | ❌ |
| Delhi | ✅ | ✅ | ✅ | ✅ |
| Mumbai | ✅ | ❌ | ✅ | ❌ |

Inventory

Warehouse

```
Shoes : 500
```

Delhi

```
Shoes : 40
```

Mumbai

```
Shoes : 30
```

---

# Online Order Fulfilment

Businesses can choose which locations are allowed to fulfil online orders.

Example

Warehouse ✅

Delhi ✅

Mumbai ❌

Mumbai inventory is reserved only for offline POS sales.

---

# Fulfilment Priority

Businesses can define the priority in which locations fulfil online orders.

Example

```
1. Warehouse

2. Delhi
```

Order arrives.

System checks

Warehouse

↓

Stock available?

↓

Yes

↓

Fulfil from Warehouse

If Warehouse has no stock

↓

Delhi

↓

Fulfil from Delhi

Mumbai is ignored.

---

# Future Fulfilment Strategies

Initially support Priority Based Fulfilment.

Later versions may support:

### 1. Priority

Warehouse

↓

Delhi

↓

Mumbai

---

### 2. Nearest Store

Customer lives in Mumbai.

Fulfil from Mumbai.

---

### 3. Highest Stock

Fulfil from location with highest available stock.

---

### 4. Lowest Shipping Cost

Choose cheapest shipping location.

---

### 5. Manual Assignment

Merchant manually assigns fulfilment location.

---

# POS Sales

POS only affects inventory of that specific location.

Example

Delhi inventory

```
Shoes : 40
```

Customer buys 3 shoes at Delhi POS.

Inventory becomes

```
37
```

Warehouse inventory remains

```
500
```

---

# Pick Up in Store (Click & Collect)

Customer places order online.

Instead of Home Delivery, customer selects

```
Pick Up from Delhi Store
```

Inventory is reserved in Delhi.

Warehouse is ignored even if it has higher priority because the customer explicitly selected Delhi.

Flow

Website

↓

Select Pickup

↓

Choose Delhi

↓

Reserve inventory

↓

Store prepares order

↓

Customer collects

---

## Rules

Pickup should only be available for locations where

- POS is enabled
- Pickup capability is enabled

Warehouse will never appear in pickup options.

---

## Pickup Edge Cases

### Customer never arrives

Merchant configures

```
Hold order for 5 days
```

If customer doesn't collect

- Cancel order
- Refund payment
- Release inventory

---

### Store closed

Temporarily hide pickup option.

---

### Store out of stock

Hide that store from pickup options.

---

### Future Enhancement

Allow transfer from Warehouse

Customer selects Delhi

Warehouse ships inventory to Delhi

Customer collects later.

---

# Return in Store

Customer purchased online.

Instead of courier return

Customer visits Delhi Store.

Staff

- Scan QR
- Verify order
- Inspect product
- Accept return
- Refund customer

---

## Rules

Return should only be available when

- POS enabled
- Return capability enabled

---

## Return Edge Cases

### Return at different location

Bought from Warehouse

Returned at Delhi

Merchant can configure

Option A

Return inventory to Delhi

Option B

Transfer inventory back to Warehouse

Option C

Move to Inspection

---

### Damaged Product

Returned product should not become sellable.

Possible inventory state

```
Damaged
```

---

### Partial Return

Customer bought

```
5 Shirts
```

Returns

```
2 Shirts
```

Refund and inventory update should be partial.

---

### Exchange

Customer exchanges

Medium

↓

Large

Handled directly through POS.

---

# Inventory Reservation

Very important for preventing overselling.

Example

Warehouse

```
Shoes : 1
```

Two customers order simultaneously.

Without reservation

Customer A buys

Customer B buys

Inventory

```
-1
```

Wrong.

Correct Flow

```
Available

↓

Reserved

↓

Payment Successful

↓

Sold
```

If payment fails

Release reservation.

---

# Inventory States

Instead of only storing quantity

Inventory should have states.

Suggested states

```
Available

Reserved

Sold

In Transit

Damaged

Returned

Inspection

Lost

Adjustment
```

---

# Stock Transfers

Move inventory between locations.

Warehouse

↓

Delhi

Transfer lifecycle

```
Created

↓

Approved

↓

Dispatched

↓

In Transit

↓

Received
```

Inventory should only increase at destination after receiving goods.

---

# Online-only Inventory

Example

Warehouse

```
100 Units
```

Business wants

```
20 reserved for online sales
```

POS should never consume them.

---

# Store-only Inventory

Business wants

```
15 units

Reserved for walk-in customers.
```

Website should ignore these.

---

# Store Closed

Delhi closed today.

Skip Delhi during fulfilment.

Move to next fulfilment location.

---

# Multi-channel Inventory

Inventory should be shared across

- Website
- POS
- Instagram
- WhatsApp
- Amazon
- Flipkart
- Future marketplaces

All channels should reserve from the same inventory.

---

# Product Availability by Location

Example

Warehouse

```
TV

Laptop

Phone
```

Delhi

```
Phone

Laptop
```

Mumbai

```
Phone
```

Website should only consider locations that stock that product.

---

# Overselling Buffer

Actual stock

```
20
```

Merchant wants to sell only

```
18
```

Buffer

```
2
```

Useful when inventory sync isn't instant.

---

# Inventory Ledger (Recommended Architecture)

Instead of directly editing inventory

Every action creates an inventory movement.

Examples

```
Purchase

Sale

Transfer

Return

Adjustment

Damage

Restock
```

Current inventory is calculated from all movements.

Benefits

- Complete audit trail
- Easy debugging
- Historical reporting
- Inventory reconciliation
- Enterprise scalability

---

# Suggested Database Model

## Locations

```
id

name

type

address
```

---

## Location Capabilities

```
location_id

pos_enabled

online_enabled

pickup_enabled

return_enabled

receive_stock

transfer_stock
```

---

## Products

```
id

sku

name
```

---

## Inventory

```
location_id

product_id

available

reserved

damaged

inspection

in_transit
```

---

## Inventory Movements

```
id

product_id

location_id

movement_type

quantity

reference_id

created_at
```

Movement Types

```
SALE

PURCHASE

RETURN

TRANSFER_OUT

TRANSFER_IN

ADJUSTMENT

DAMAGE

RESERVATION

RELEASE_RESERVATION
```

---

# Permissions

Example

Delhi Manager

✅ Sell products

✅ Receive stock

❌ Edit Mumbai inventory

❌ View Warehouse inventory

Warehouse Manager

✅ Manage Warehouse

Regional Manager

✅ View all locations

Super Admin

✅ Full access

---

# Recommended Development Roadmap

## Phase 1 (MVP)

- Single location
- POS
- Website
- Shared inventory
- Basic reservations

---

## Phase 2

- Multiple locations
- Fulfilment priority
- Warehouse
- Stock transfers

---

## Phase 3

- Pick Up in Store
- Return in Store
- Location capabilities
- User permissions

---

## Phase 4

- Nearest fulfilment
- Shipping cost optimisation
- Split shipments
- Inventory buffers

---

## Phase 5

- Multi-channel inventory
- Amazon integration
- Flipkart integration
- WhatsApp orders
- Analytics
- AI inventory forecasting

---

# Design Principles

1. Inventory belongs to locations, not the business globally.
2. Every location has configurable capabilities.
3. Inventory should be reserved before payment is confirmed.
4. Every inventory change must be traceable through an inventory ledger.
5. Customer-selected pickup locations always override automatic fulfilment logic.
6. Returns should be configurable and not automatically become sellable stock.
7. Keep the MVP simple while designing the data model for enterprise scale.
8. Support growth from a single shop to hundreds of locations without changing the core architecture.