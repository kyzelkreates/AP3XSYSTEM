import React, { useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AP3XProvider } from "./store/ap3x.js";
import Sidebar    from "./components/layout/Sidebar.jsx";
import ToastContainer from "./components/layout/Toast.jsx";
import Overview   from "./pages/Overview.jsx";
import Fleets     from "./pages/Fleets.jsx";
import Drivers    from "./pages/Drivers.jsx";
import Vehicles   from "./pages/Vehicles.jsx";
import Devices    from "./pages/Devices.jsx";
import Identities from "./pages/Identities.jsx";
import Routes_    from "./pages/Routes.jsx";
import Hazards    from "./pages/Hazards.jsx";
import Safety     from "./pages/Safety.jsx";
import Events     from "./pages/Events.jsx";
import Deploy     from "./pages/Deploy.jsx";
import Audit      from "./pages/Audit.jsx";

export default function App() {
  const [activeFleet, setActiveFleet] = useState("");

  return (
    <AP3XProvider>
      <div className="app-shell">
        <Sidebar activeFleet={activeFleet} onFleetChange={setActiveFleet} />
        <Routes>
          <Route path="/"           element={<Overview   activeFleet={activeFleet} />} />
          <Route path="/fleets"     element={<Fleets     activeFleet={activeFleet} />} />
          <Route path="/drivers"    element={<Drivers    activeFleet={activeFleet} />} />
          <Route path="/vehicles"   element={<Vehicles   activeFleet={activeFleet} />} />
          <Route path="/devices"    element={<Devices    activeFleet={activeFleet} />} />
          <Route path="/identities" element={<Identities activeFleet={activeFleet} />} />
          <Route path="/routes"     element={<Routes_    activeFleet={activeFleet} />} />
          <Route path="/hazards"    element={<Hazards    activeFleet={activeFleet} />} />
          <Route path="/safety"     element={<Safety     activeFleet={activeFleet} />} />
          <Route path="/events"     element={<Events     activeFleet={activeFleet} />} />
          <Route path="/deploy"     element={<Deploy     activeFleet={activeFleet} />} />
          <Route path="/audit"      element={<Audit      activeFleet={activeFleet} />} />
          <Route path="*"           element={<Navigate to="/" />} />
        </Routes>
        <ToastContainer />
      </div>
    </AP3XProvider>
  );
}
