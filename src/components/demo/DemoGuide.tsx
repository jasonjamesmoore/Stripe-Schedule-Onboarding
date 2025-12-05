"use client";

import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Info, X, Calendar, MapPin, DollarSign } from "lucide-react";

type DemoAddress = {
  city: string;
  zip: string;
  state: string;
  seasonalStatus: "In Season (Active)" | "Out of Season" | "No Seasonal Service";
  seasonDates?: string;
  pickupDays: string;
};

const DEMO_ADDRESSES: DemoAddress[] = [
  {
    city: "Topsail Beach",
    zip: "28445",
    state: "NC",
    seasonalStatus: "In Season (Active)",
    seasonDates: "Nov 1, 2025 - Mar 1, 2026",
    pickupDays: "Mon (base) + Thu (seasonal)"
  },
  {
    city: "Surf City",
    zip: "28445",
    state: "NC",
    seasonalStatus: "In Season (Active)",
    seasonDates: "Oct 15, 2025 - Feb 28, 2026",
    pickupDays: "Tue (base) + Fri (seasonal)"
  },
  {
    city: "North Topsail Beach",
    zip: "28460",
    state: "NC",
    seasonalStatus: "Out of Season",
    seasonDates: "Apr 1, 2026 - Sep 30, 2026",
    pickupDays: "Wed (base) + Sat (seasonal when in season)"
  },
  {
    city: "Wilmington",
    zip: "28401",
    state: "NC",
    seasonalStatus: "No Seasonal Service",
    pickupDays: "Tue (base only)"
  }
];

export function DemoGuide() {
  const [isOpen, setIsOpen] = useState(true);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    // Add a small delay before attaching the listener to avoid closing immediately
    const timeoutId = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        className="fixed bottom-4 right-4 gap-2 shadow-lg z-50"
      >
        <Info className="h-4 w-4" />
        Demo Guide
      </Button>
    );
  }

  return (
    <Card ref={cardRef} className="fixed bottom-4 right-4 w-[400px] max-h-[600px] overflow-y-auto shadow-2xl z-50 border-2 border-blue-200">
      <CardHeader className="relative pb-3">
        <Button
          onClick={() => setIsOpen(false)}
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 h-6 w-6"
        >
          <X className="h-4 w-4" />
        </Button>
        <CardTitle className="text-lg flex items-center gap-2">
          <Info className="h-5 w-5 text-blue-600" />
          Portfolio Demo Guide
        </CardTitle>
        <CardDescription>
          Testing the seasonal subscription scheduler
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        <div className="rounded-lg bg-blue-50 p-3 text-sm">
          <p className="font-medium text-blue-900 mb-1">
            🎯 How to test this app:
          </p>
          <p className="text-blue-800">
            <strong>Click &quot;Fill Demo Data&quot; and proceed to step 3.</strong><br />
            <br />
            <strong>Prefer to test manually? Follow these steps:</strong><br />
            <br />
            1. Enter demo Customer Data <br />
            <br />
            2. Add multiple service addresses using the zip codes below. Mix in-season and out-of-season properties to see how the subscription schedule adapts pricing automatically.<br />
            <br />
            3. Complete the payment with Stripe Test Card Data to view the generated subscription schedule with phase breakdowns.<br />
          </p>
        </div>

        <div className="space-y-3">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <MapPin className="h-4 w-4" />
            Test Addresses
          </h4>
          
          {DEMO_ADDRESSES.map((addr, idx) => (
            <Card key={idx} className="border">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between">
                  <div className="font-medium text-sm">
                    {addr.city}, {addr.state}
                  </div>
                  <div className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded">
                    {addr.zip}
                  </div>
                </div>
                
                <div className="flex items-center gap-1 text-xs">
                  <span
                    className={`inline-block w-2 h-2 rounded-full ${
                      addr.seasonalStatus === "In Season (Active)"
                        ? "bg-green-500"
                        : addr.seasonalStatus === "Out of Season"
                        ? "bg-yellow-500"
                        : "bg-gray-400"
                    }`}
                  />
                  <span className="font-medium">{addr.seasonalStatus}</span>
                </div>
                
                {addr.seasonDates && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Calendar className="h-3 w-3" />
                    {addr.seasonDates}
                  </div>
                )}
                
                <div className="text-xs text-muted-foreground">
                  {addr.pickupDays}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="rounded-lg bg-amber-50 p-3 text-sm space-y-2">
          <p className="font-medium text-amber-900 flex items-center gap-1">
            <DollarSign className="h-4 w-4" />
            Pricing Demo
          </p>
          <p className="text-amber-800 text-xs">
            The subscription will show different monthly prices based on which properties are in their seasonal window. After payment, you&apos;ll see the complete schedule with phase breakdowns.
          </p>
        </div>

        <div className="rounded-lg bg-green-50 p-3 text-sm">
          <p className="font-medium text-green-900 mb-1">
            💡 Suggested Test Flow:
          </p>
          <ol className="text-green-800 text-xs space-y-1 list-decimal list-inside">
            <li>Add Topsail Beach (in-season)</li>
            <li>Add North Topsail Beach (out-of-season)</li>
            <li>Add Wilmington (no seasonal)</li>
            <li>Complete payment to see schedule</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
