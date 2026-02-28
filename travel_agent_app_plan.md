# Travel Agent ReactJS App - Development Plan

## 1. Project Overview
A comprehensive ReactJS application designed for travel agents to manage clients, build custom itineraries, track bookings, and handle invoicing efficiently.

## 2. Tech Stack
*   **Framework:** ReactJS (bootstrapped with Vite for speed)
*   **Language:** TypeScript (for type safety and better developer experience)
*   **Styling:** Tailwind CSS (utility-first styling) + shadcn/ui (accessible components)
*   **State Management:** Zustand (lightweight global state)
*   **Routing:** React Router v6
*   **Data Fetching:** TanStack Query (React Query) for server state caching
*   **Forms:** React Hook Form + Zod (validation)

## 3. Core Features
*   **Dashboard:** High-level overview of upcoming trips, pending tasks, and recent revenue.
*   **Client CRM:** Manage client profiles, travel preferences, passport details, and past trips.
*   **Itinerary Builder:** A drag-and-drop interface to construct daily schedules including flights, accommodations, transfers, and activities.
*   **Booking Tracker:** Monitor the status of various reservations (Confirmed, Pending, Cancelled).
*   **Invoicing:** Generate PDF invoices and track payment statuses.

## 4. Folder Structure (Feature-Sliced Design)
```text
src/
├── assets/         # Static files (images, icons)
├── components/     # Shared UI components (buttons, inputs, modals)
├── features/       # Feature-specific modules
│   ├── auth/       # Login, registration
│   ├── clients/    # Client list, client details
│   ├── itineraries/# Builder, viewer
│   └── dashboard/  # Overview widgets
├── hooks/          # Shared custom hooks
├── layouts/        # Page layouts (Sidebar, Header)
├── lib/            # Third-party library configurations (axios, queryClient)
├── routes/         # Route definitions
├── store/          # Global state (Zustand)
├── types/          # Global TypeScript interfaces
└── utils/          # Helper functions (date formatting, currency)
```

## 5. Development Phases

### Phase 1: Project Setup & Foundation
*   Initialize Vite + React + TypeScript project.
*   Configure Tailwind CSS and ESLint/Prettier.
*   Set up React Router with a basic layout (Sidebar + Header).
*   Implement mock authentication.

### Phase 2: Client Management (CRM)
*   Create the Client List view with search and filtering.
*   Build the Client Profile page (view/edit details).
*   Implement forms using React Hook Form and Zod.

### Phase 3: Itinerary Builder (Core Feature)
*   Develop the UI for creating a new trip.
*   Implement a day-by-day builder using drag-and-drop (e.g., `@hello-pangea/dnd`).
*   Add forms to input flight details, hotel bookings, and activities.

### Phase 4: Dashboard & Bookings
*   Build the Dashboard with summary statistics and upcoming trip lists.
*   Create a Booking Tracker table to manage reservation statuses.

### Phase 5: Polish & Deployment
*   Add loading skeletons and toast notifications for better UX.
*   Write unit tests for critical utility functions and components.
*   Deploy the application to Vercel or Netlify.
