//
//  Nothing_X_MacOSApp.swift
//  Nothing X MacOS
//
//  Created by Arunavo Ray on 07/01/23.
//

import SwiftUI


@main
struct Nothing_X_MacOSApp: App {
    @StateObject private var store = Store()
    @StateObject private var viewModel = MainViewViewModel(bluetoothService: BluetoothServiceImpl(), nothingRepository: NothingRepositoryImpl.shared, nothingService: NothingServiceImpl.shared)
    @StateObject private var budsPickerViewModel = BudsPickerComponentViewModel()

    var body: some Scene {
        MenuBarExtra {
            NavigationStack(path: $viewModel.navigationPath.animation(.default)) {
                
                HomeView()
                    .navigationDestination(for: Destination.self) { destination in
                        switch(destination) {
                        case .home: HomeView()
                                .transition(.asymmetric(insertion: .opacity, removal: .opacity))
                        case .equalizer: EqualizerView(eqMode: $viewModel.eqProfiles)
                        case .controls: ControlsView()
                        case .controlsTripleTap: ControlsDetailView(destination: .controlsTripleTap, leftTripleTapAction: $viewModel.leftTripleTapAction, rightTripleTapAction: $viewModel.rightTripleTapAction, leftTapAndHoldAction: $viewModel.leftTapAndHoldAction, rightTapAndHoldAction: $viewModel.rightTapAndHoldAction)
                        case .controlsTapHold: ControlsDetailView(destination: .controlsTapHold,
                                                                  leftTripleTapAction: $viewModel.leftTripleTapAction, rightTripleTapAction: $viewModel.rightTripleTapAction, leftTapAndHoldAction: $viewModel.leftTapAndHoldAction, rightTapAndHoldAction: $viewModel.rightTapAndHoldAction
                        )
                        case .settings: SettingsView()
                        case .findMyBuds: FindMyBudsView()
                        case .discover: DiscoverView()
                                .transition(.asymmetric(insertion: .opacity, removal: .opacity))
                        case .connect: ConnectView()
                            //                                .animation(nil)
                                .transition(.asymmetric(insertion: .opacity, removal: .opacity))
                        case .discover_started: DiscoverStartedView()
                        case .bluetooth_off: BluetoothIsOffView()
                            
                        }
                        
                        
                    }
                    
            }
            .environmentObject(store)
            .environmentObject(viewModel)
            .environmentObject(budsPickerViewModel)
            .frame(width: 250, height: 230)
        
            
        } label: {
            let codename = viewModel.nothingDevice?.codename
            let leftBattery = viewModel.nothingDevice?.leftBattery
            let rightBattery = viewModel.nothingDevice?.rightBattery

            let (iconName, deviceName): (String, String) = {
                switch codename {
                case .ONE: return ("nothing.ear.1", "Ear (1)")
                case .TWO: return ("nothing.ear.2", "Ear (2)")
                case .STICKS: return ("nothing.stick", "Ear (stick)")
                case .CORSOLA: return ("cmf.buds", "CMF Buds")
                case .CMF_BUDS: return ("cmf.buds", "CMF Buds")
                case .CMF_BUDS_PRO: return ("cmf.buds.pro", "CMF Buds Pro")
                case .CMF_BUDS_PRO_2: return ("cmf.buds.pro2", "CMF Buds Pro 2")
                // Дополните для всех новых моделей
                default: return ("nothing.ear.1", "Nothing Audio")
                }
            }()

            if let left = leftBattery, let right = rightBattery {
                Label("\(deviceName): \(Double(left + right) / 2.0, specifier: "%.0f")%", image: iconName)
                    .labelStyle(.titleAndIcon)
            } else {
                Label(deviceName, image: iconName)
                    .labelStyle(.titleAndIcon)
            }
        }
        .menuBarExtraStyle(.window)
        
    }
}
